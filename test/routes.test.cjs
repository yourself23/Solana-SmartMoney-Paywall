const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SOLANA_RPC_URL = "https://rpc.test";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
delete process.env.TREASURY_WALLET;

const paywall = require("../.test-build/lib/paywall.js");
const smart = require("../.test-build/lib/smart.js");
const trending = require("../.test-build/api/alpha/trending.js").default;
const wallet = require("../.test-build/api/alpha/wallet.js").default;
const buyers = require("../.test-build/api/alpha/early-buyers.js").default;
const overlap = require("../.test-build/api/alpha/overlap.js").default;
const mintPass = require("../.test-build/api/credits/mint.js").default;
const mcp = require("../.test-build/api/mcp/index.js").default;
const treasury = paywall.TREASURY;
const mint = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const secondWallet = "11111111111111111111111111111111";
const store = new Map();
let rpcCalls = [];
let feed = "fail";
let rpcFail = false;
let sendError = false;
let transaction = null;
let storeFailure = false;

function req({ body = {}, query = {}, headers = {}, method = "POST" } = {}) {
  return { body, query, headers, method };
}
function response() {
  const result = { statusCode: 0, body: undefined, headers: {} };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; return this; },
    end() { return this; },
  };
  return { result, res };
}
function solTx(lamports = 5_000_000) {
  return {
    meta: { err: null, preBalances: [1_000_000], postBalances: [1_000_000 + lamports], preTokenBalances: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: [{ pubkey: treasury, signer: false }] } },
  };
}
function balance(amount, owner = treasury, accountIndex = 0) {
  return { mint: paywall.USDC_MINT, owner, accountIndex, uiTokenAmount: { amount } };
}
function usdcTx(before, after) {
  const tx = solTx(0);
  tx.meta.preTokenBalances = before;
  tx.meta.postTokenBalances = after;
  return tx;
}

global.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === "https://api.dexscreener.com/token-boosts/top/v1") {
    if (feed === "fail") return new Response("rate limit", { status: 429 });
    if (feed === "invalid") return Response.json({ bad: true });
    return Response.json([{ chainId: "solana", tokenAddress: mint, totalAmount: 12 }, { chainId: "solana", tokenAddress: mint }, { chainId: "other", tokenAddress: treasury }]);
  }
  if (url === "https://rpc.test") {
    const request = JSON.parse(init.body);
    rpcCalls.push(request);
    if (rpcFail) throw new Error("RPC offline");
    if (request.method === "sendTransaction" && sendError) return Response.json({ error: { message: "broadcast rejected" } });
    const results = {
      getRecentPerformanceSamples: [], getSupply: { value: { total: 1 } }, getBalance: null,
      getTokenAccountsByOwner: null, getSignaturesForAddress: null,
      getTransaction: transaction, sendTransaction: "3".repeat(88),
    };
    if (!(request.method in results)) throw new Error(`Unexpected RPC: ${request.method}`);
    return Response.json({ result: results[request.method] });
  }
  if (url === "https://redis.test") {
    if (storeFailure) return Response.json({ error: "unavailable" }, { status: 503 });
    const [op, ...args] = JSON.parse(init.body);
    if (op === "PING") return Response.json({ result: "PONG" });
    if (op === "GET") return Response.json({ result: store.get(args[0]) ?? null });
    if (op === "EVAL" && args[0].includes("KEYS[4]")) {
      const [, , sigKey, key, countKey, , route, , credits] = args;
      if (store.has(sigKey)) return Response.json({ result: 0 });
      store.set(sigKey, route);
      store.set(countKey, Number(store.get(countKey) || 0) + 1);
      if (credits) store.set(key, Number(credits));
      return Response.json({ result: 1 });
    }
    if (op === "EVAL" && args[0].includes("DECR")) {
      const key = args[2], current = Number(store.get(key) || 0);
      if (current <= 0) return Response.json({ result: -1 });
      store.set(key, current - 1);
      return Response.json({ result: current - 1 });
    }
    throw new Error(`Unexpected Redis command ${op}`);
  }
  throw new Error(`Unexpected URL: ${url}`);
};

test("trending falls back to Mainnet RPC on feed error without requiring payment", async () => {
  rpcCalls = [];
  const { result, res } = response();
  await trending(req({ method: "GET" }), res);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.source, "solana-mainnet-rpc");
  assert.deepEqual(result.body.trendingMints, []);
  assert.deepEqual(rpcCalls.map((call) => call.method).sort(), ["getRecentPerformanceSamples", "getSupply"]);
});

test("trending reports unavailable if both feed and RPC fail", async () => {
  rpcFail = true;
  try {
    const { result, res } = response();
    await trending(req({ method: "GET" }), res);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.source, "unavailable");
    assert.deepEqual(result.body.trendingMints, []);
  } finally { rpcFail = false; }
});

test("free MCP tool returns real feed, and falls back when feed is malformed", async () => {
  feed = "ok";
  const request = req({ body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "smart_trending_mints" } } });
  const first = response();
  await mcp(request, first.res);
  assert.equal(first.result.statusCode, 200);
  const data = JSON.parse(first.result.body.result.content[0].text);
  assert.equal(data.source, "dexscreener-token-boosts");
  assert.deepEqual(data.trendingMints.map((item) => item.mint), [mint]);
  feed = "invalid";
  const retry = response();
  await mcp(request, retry.res);
  assert.equal(JSON.parse(retry.result.body.result.content[0].text).source, "solana-mainnet-rpc");
});

test("public keys reject invalid base58 and wrong decoded length", () => {
  assert.ok(smart.validAddress(treasury));
  assert.ok(smart.validAddress(secondWallet));
  for (const value of ["0".repeat(44), "z".repeat(44), "1".repeat(31), "1".repeat(33)]) assert.equal(smart.validAddress(value), false);
});

test("invalid inputs return 400 before payment", async () => {
  for (const [handler, query] of [[wallet, { wallet: "0".repeat(40) }], [buyers, { mint: "bad" }], [overlap, { wallets: `${treasury},bad` }], [overlap, { wallets: `${treasury},${treasury}` }]]) {
    const { result, res } = response();
    await handler(req({ query, headers: { "x-payment": "1".repeat(88) } }), res);
    assert.equal(result.statusCode, 400);
  }
  const { result, res } = response();
  await mcp(req({ body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "smart_wallet_profile", arguments: { wallet: "bad" } } }, headers: { "x-payment": "1".repeat(88) } }), res);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error.code, -32602);
});

test("empty RPC results are safe in analytics", async () => {
  assert.equal((await smart.profileWallet(treasury)).recentTxCount, 0);
  assert.deepEqual((await smart.findEarlyBuyers(mint)).earliestBuyers, []);
  assert.deepEqual((await smart.findWalletOverlap([treasury, secondWallet])).sharedAlphaMints, []);
  await assert.rejects(() => smart.findWalletOverlap([treasury, treasury]), /distinct/);
});

test("all paid routes and MCP return v2 SOL and USDC challenges", async () => {
  const routes = [
    [wallet, req({ query: { wallet: treasury } }), "5000000", "500000"],
    [buyers, req({ query: { mint } }), "5000000", "500000"],
    [overlap, req({ query: { wallets: `${treasury},${secondWallet}` } }), "5000000", "500000"],
    [mintPass, req(), "50000000", "5000000"],
    [mcp, req({ body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "smart_wallet_profile", arguments: { wallet: treasury } } } }), "5000000", "500000"],
  ];
  for (const [handler, request, sol, usdc] of routes) {
    const { result, res } = response();
    await handler(request, res);
    assert.equal(result.statusCode, 402);
    assert.equal(result.body.x402Version, 2);
    assert.deepEqual(result.body.accepts.map((item) => [item.asset, item.amount, item.payTo]), [
      ["So11111111111111111111111111111111111111112", sol, treasury], [paywall.USDC_MINT, usdc, treasury],
    ]);
    assert.deepEqual(JSON.parse(Buffer.from(result.headers["payment-required"], "base64").toString()).accepts, result.body.accepts);
  }
});

test("X-PAYMENT transaction is broadcast with skipPreflight and settled once", async () => {
  transaction = solTx();
  rpcCalls = [];
  const encoded = Buffer.from(JSON.stringify({ payload: { transaction: Buffer.from("signed transaction").toString("base64") } })).toString("base64");
  const call = () => req({ query: { wallet: treasury }, headers: { "x-payment": encoded } });
  const first = response();
  await wallet(call(), first.res);
  assert.equal(first.result.statusCode, 200);
  const broadcast = rpcCalls.find((entry) => entry.method === "sendTransaction");
  assert.equal(broadcast.params[1].skipPreflight, true);
  assert.equal(broadcast.params[1].encoding, "base64");
  const retry = response();
  await wallet(call(), retry.res);
  assert.equal(retry.result.statusCode, 402);
  assert.match(retry.result.body.error, /already redeemed/);
});

test("SOL payments enforce threshold, confirmation, and replay protection", async () => {
  const sig = "4".repeat(88);
  transaction = solTx(4_999_999);
  assert.equal((await paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test")).ok, false);
  assert.equal(store.has(`sm:tx:${sig}`), false);
  transaction = null;
  assert.equal((await paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test")).pending, true);
  transaction = solTx();
  const results = await Promise.all([paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test"), paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test")]);
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
});

test("USDC uses net treasury deltas, exact atomic thresholds and all accounts", async () => {
  const sig = "5".repeat(88);
  transaction = usdcTx([balance("30000000")], [balance("30499999")]);
  assert.equal((await paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test")).ok, false);
  transaction = usdcTx([balance("30000000")], [balance("30200000"), balance("300000", treasury, 1)]);
  assert.equal((await paywall.verifyPayment(sig, paywall.MICRO_LAMPORTS, "/test")).ok, true);
  transaction = usdcTx([balance("30000000")], [balance("31000000")]);
  transaction.meta.preTokenBalances[0].owner = undefined;
  await assert.rejects(paywall.verifyPayment("6".repeat(88), paywall.MICRO_LAMPORTS, "/test"), /USDC balance metadata/);
});

test("pass mint is atomic with payment and credits cannot go negative", async () => {
  transaction = solTx(paywall.PASS_LAMPORTS);
  const signature = "7".repeat(88);
  const result = response();
  await mintPass(req({ body: { signature } }), result.res);
  assert.equal(result.result.statusCode, 200);
  const key = result.result.body.apiKey;
  assert.match(key, /^sm_live_/);
  assert.equal(store.get(`sm:key:${key}`), 30);
  assert.equal(store.get(`sm:tx:${signature}`), "/api/credits/mint");
  const retry = response();
  await mintPass(req({ body: { signature } }), retry.res);
  assert.equal(retry.result.statusCode, 402);
  store.set(`sm:key:${key}`, 1);
  const first = response(), second = response();
  await Promise.all([wallet(req({ query: { wallet: treasury }, headers: { authorization: `Bearer ${key}` } }), first.res), wallet(req({ query: { wallet: treasury }, headers: { authorization: `Bearer ${key}` } }), second.res)]);
  assert.deepEqual([first.result.statusCode, second.result.statusCode].sort(), [200, 402]);
  assert.equal(store.get(`sm:key:${key}`), 0);
});

test("USDC pass enforces 5 USDC before issuing 30 credits", async () => {
  const signature = "9".repeat(88);
  transaction = usdcTx([balance("1000000")], [balance("5999999")]);
  const insufficient = response();
  await mintPass(req({ body: { signature } }), insufficient.res);
  assert.equal(insufficient.result.statusCode, 402);
  transaction = usdcTx([balance("1000000")], [balance("6000000")]);
  const accepted = response();
  await mintPass(req({ body: { signature } }), accepted.res);
  assert.equal(accepted.result.statusCode, 200);
  assert.equal(accepted.result.body.credits, 30);
});

test("paid MCP call settles then executes the selected tool", async () => {
  transaction = solTx();
  const result = response();
  await mcp(req({ headers: { "payment-signature": "A".repeat(88) }, body: { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "smart_wallet_profile", arguments: { wallet: treasury } } } }), result.res);
  assert.equal(result.result.statusCode, 200);
  assert.equal(JSON.parse(result.result.body.result.content[0].text).wallet, treasury);
});

test("payment errors and unconfirmed transactions do not consume payment", async () => {
  const encoded = Buffer.from(JSON.stringify({ payload: { transaction: Buffer.from("signed").toString("base64") } })).toString("base64");
  transaction = null;
  const pending = response();
  await mintPass(req({ headers: { "payment-signature": encoded } }), pending.res);
  assert.equal(pending.result.statusCode, 402);
  assert.equal(pending.result.body.payment_signature, "3".repeat(88));
  sendError = true;
  try {
    const failed = response();
    await mintPass(req({ headers: { "payment-signature": encoded } }), failed.res);
    assert.equal(failed.result.statusCode, 503);
  } finally { sendError = false; }
  const malformed = response();
  await mintPass(req({ headers: { "payment-signature": "not-json" } }), malformed.res);
  assert.equal(malformed.result.statusCode, 400);
  transaction = solTx(paywall.PASS_LAMPORTS);
  storeFailure = true;
  try {
    const unavailable = response();
    await mintPass(req({ body: { signature: "8".repeat(88) } }), unavailable.res);
    assert.equal(unavailable.result.statusCode, 503);
    assert.equal(store.has(`sm:tx:${"8".repeat(88)}`), false);
  } finally { storeFailure = false; }
});
