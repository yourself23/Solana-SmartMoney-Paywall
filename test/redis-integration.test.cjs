const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const cli = process.env.REDIS_TEST_CLI;
const socket = process.env.REDIS_TEST_SOCKET;

test("Redis atomically issues one pass and permanently protects the signature", { skip: !cli || !socket }, async () => {
  process.env.SOLANA_RPC_URL = "https://rpc.test";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  delete process.env.TREASURY_WALLET;
  const { verifyPayment, TREASURY, PASS_LAMPORTS } = require("../.test-build/lib/paywall.js");
  const command = (...args) => JSON.parse(execFileSync(cli, ["-s", socket, "--json", ...args.map(String)], { encoding: "utf8" }));
  const signature = "B".repeat(88);
  const legacySignature = "C".repeat(88);
  const key1 = "sm_live_test1", key2 = "sm_live_test2";
  const keys = [`sm:tx:${signature}`, `sm:key:${key1}`, `sm:key:${key2}`, "sm:stats:tx_count", "sm:stats:recent", `sm:tx:${legacySignature}`];
  assert.equal(command("DBSIZE"), 0, "Integration tests require a dedicated empty Redis instance");
  global.fetch = async (input, init) => {
    if (String(input) === "https://rpc.test") return Response.json({ result: {
      meta: { err: null, preBalances: [0], postBalances: [PASS_LAMPORTS], preTokenBalances: [], postTokenBalances: [] },
      transaction: { message: { accountKeys: [TREASURY] } },
    } });
    const args = JSON.parse(init.body);
    return Response.json({ result: command(...args) });
  };
  try {
    const result = await Promise.all([
      verifyPayment(signature, PASS_LAMPORTS, "/pass", key1),
      verifyPayment(signature, PASS_LAMPORTS, "/pass", key2),
    ]);
    assert.deepEqual(result.map((item) => item.ok).sort(), [false, true]);
    assert.equal(command("TTL", keys[0]), -1);
    assert.equal(command("EXISTS", keys[1]) + command("EXISTS", keys[2]), 1);
    const issued = command("EXISTS", keys[1]) ? keys[1] : keys[2];
    assert.equal(command("GET", issued), "30");
    assert.ok(command("TTL", issued) > 0);
    assert.equal(command("GET", keys[3]), "1");
    assert.equal(command("LLEN", keys[4]), 1);
    command("SET", keys[5], "/old", "EX", 60);
    assert.equal((await verifyPayment(legacySignature, PASS_LAMPORTS, "/pass", key1)).ok, false);
    assert.equal(command("TTL", keys[5]), -1);
  } finally {
    command("DEL", ...keys);
  }
});
