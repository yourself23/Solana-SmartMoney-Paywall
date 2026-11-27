import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

export const USDC_TREASURY = process.env.USDC_TREASURY_WALLET?.trim() || "5Y7aEmYpCyMJanR9qjCUYf59voi6EsJrkjsJB2cNMsW";
export const SOL_TREASURY = process.env.SOL_TREASURY_WALLET?.trim() || "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2";
export const TREASURY = USDC_TREASURY;
export const RPC_URL = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MICRO_LAMPORTS = 5_000_000;
export const PASS_LAMPORTS = 50_000_000;
export const PASS_CREDITS = 30;
const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export async function solRpc(method: string, params: unknown[]) {
  const response = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const data = await response.json() as any;
  if (data.error) throw new Error(`Solana RPC: ${data.error.message || "request failed"}`);
  if (!("result" in data)) throw new Error("Solana RPC response missing result");
  return data.result;
}

async function upstash(cmd: (string | number)[]) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("Upstash Redis is not configured");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const data = await response.json() as { result?: unknown; error?: string };
  if (data.error) throw new Error(`Redis: ${data.error}`);
  if (!("result" in data)) throw new Error("Redis response missing result");
  return data.result;
}

export const redis = { get: async <T = string>(key: string) => await upstash(["GET", key]) as T | null };

export function send402(res: VercelResponse, minL: number, route: string, msg = "Payment Required (x402 Native SOL or USDC)", signature?: string) {
  const usdc = minL >= PASS_LAMPORTS ? "5000000" : "500000";
  const accepts = [
    { scheme: "exact", network: NETWORK, asset: "So11111111111111111111111111111111111111112", amount: String(minL), payTo: SOL_TREASURY, maxTimeoutSeconds: 60, extra: {} },
    { scheme: "exact", network: NETWORK, asset: USDC_MINT, amount: usdc, payTo: TREASURY, maxTimeoutSeconds: 60, extra: {} },
  ];
  const challenge = { x402Version: 2, resource: { url: route, mimeType: "application/json" }, accepts };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  return res.status(402).json({ ...challenge, error: msg, treasury: TREASURY, amount_lamports: minL, amount_usdc_atomic: Number(usdc), ...(signature ? { payment_signature: signature } : {}), pass_option: { endpoint: "/api/credits/mint", amount_lamports: PASS_LAMPORTS, amount_usdc_atomic: 5000000, credits: PASS_CREDITS } });
}

export class PaymentInputError extends Error {}

export function hasPayment(req: VercelRequest): boolean {
  return Boolean(req.headers.authorization || req.headers["x-payment-signature"] || req.headers["x-payment"] || req.headers["payment-signature"] || req.query?.signature || req.body?.signature);
}

export async function resolveSig(req: VercelRequest): Promise<string> {
  const raw = String(req.headers["x-payment-signature"] || req.headers["x-payment"] || req.headers["payment-signature"] || req.query?.signature || req.body?.signature || "").trim();
  if (!raw) return "";
  if (/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(raw)) return raw;
  let payload: any;
  try { payload = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")); }
  catch { throw new PaymentInputError("Invalid payment header"); }
  const signature = payload?.payload?.signature || payload?.signature || payload?.txHash;
  const transaction = payload?.payload?.transaction || payload?.transaction;
  if (transaction === undefined && typeof signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return signature;
  if (typeof transaction !== "string") throw new PaymentInputError("Payment transaction is required");
  const bytes = Buffer.from(transaction, "base64");
  if (!bytes.length || bytes.length > 1232 || bytes.toString("base64") !== transaction) throw new PaymentInputError("Invalid serialized transaction");
  if (await upstash(["PING"]) !== "PONG") throw new Error("Payment store is unavailable");
  const result = await solRpc("sendTransaction", [transaction, { encoding: "base64", skipPreflight: true, preflightCommitment: "confirmed" }]);
  if (typeof result !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result)) throw new Error("Invalid broadcast signature from Solana RPC");
  return result;
}

export async function verifyPayment(signature: string, minL: number, route: string, apiKey?: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { ok: false, error: "Invalid signature" };
  const tx = await solRpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  if (!tx || !tx.meta || tx.meta.err !== null) return { ok: false, error: "Transaction not confirmed or failed", pending: !tx };
  const keys: string[] = (tx.transaction?.message?.accountKeys || []).map((k: any) => typeof k === "string" ? k : k.pubkey);
  const idx = keys.indexOf(SOL_TREASURY);
  const pre = tx.meta.preBalances?.[idx], post = tx.meta.postBalances?.[idx];
  if (idx >= 0 && (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post))) throw new Error("Invalid treasury SOL balances");
  const solIn = idx < 0 ? 0n : BigInt(post) - BigInt(pre);
  const preTokens = tx.meta.preTokenBalances, postTokens = tx.meta.postTokenBalances;
  if ((!Array.isArray(preTokens) || !Array.isArray(postTokens)) && solIn < BigInt(minL)) throw new Error("Missing token balance metadata");
  const tokenTotal = (balances: any[]) => balances.reduce((sum: bigint, balance: any) => {
    if (balance.mint !== USDC_MINT) return sum;
    if (typeof balance.owner !== "string" || typeof balance.uiTokenAmount?.amount !== "string" || !/^\d+$/.test(balance.uiTokenAmount.amount)) throw new Error("Invalid USDC balance metadata");
    return balance.owner === TREASURY ? sum + BigInt(balance.uiTokenAmount.amount) : sum;
  }, 0n);
  const usdcIn = Array.isArray(preTokens) && Array.isArray(postTokens) ? tokenTotal(postTokens) - tokenTotal(preTokens) : 0n;
  if (solIn < BigInt(minL) && usdcIn < (minL >= PASS_LAMPORTS ? 5_000_000n : 500_000n)) return { ok: false, error: "Insufficient SOL or USDC transfer" };
  const record = JSON.stringify({ sig: signature, solIn: solIn.toString(), usdcIn: usdcIn.toString(), route, ts: Date.now() });
  const result = await upstash(["EVAL", `
    if redis.call('EXISTS', KEYS[1]) == 1 then
      redis.call('PERSIST', KEYS[1])
      return 0
    end
    if ARGV[3] ~= '' and redis.call('EXISTS', KEYS[2]) == 1 then return redis.error_reply('API key already exists') end
    local count = redis.call('GET', KEYS[3])
    if count and not tonumber(count) then return redis.error_reply('Invalid transaction count') end
    local kind = redis.call('TYPE', KEYS[4]).ok
    if kind ~= 'none' and kind ~= 'list' then return redis.error_reply('Invalid events list') end
    redis.call('INCR', KEYS[3])
    redis.call('LPUSH', KEYS[4], ARGV[2])
    redis.call('LTRIM', KEYS[4], 0, 24)
    if ARGV[3] ~= '' then redis.call('SET', KEYS[2], ARGV[3], 'EX', 2592000) end
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
  `, 4, `sm:tx:${signature}`, apiKey ? `sm:key:${apiKey}` : "sm:unused", "sm:stats:tx_count", "sm:stats:recent", route, record, apiKey ? String(PASS_CREDITS) : ""]);
  if (result === 0) return { ok: false, error: "Signature already redeemed" };
  if (result !== 1) throw new Error("Invalid Redis settlement result");
  return { ok: true };
}

export async function requireGate(req: VercelRequest, res: VercelResponse, minL: number, route: string): Promise<boolean> {
  try {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer sm_live_")) {
      const remaining = await upstash(["EVAL", `
        local value = redis.call('GET', KEYS[1])
        if not value or not tonumber(value) or tonumber(value) <= 0 then return -1 end
        return redis.call('DECR', KEYS[1])
      `, 1, `sm:key:${auth.slice(7).trim()}`]);
      if (typeof remaining !== "number") throw new Error("Invalid credit balance");
      if (remaining >= 0) { res.setHeader("X-Credits-Remaining", String(remaining)); return true; }
      send402(res, minL, route, "Alpha pass depleted or invalid");
      return false;
    }
    const signature = await resolveSig(req);
    if (!signature) { send402(res, minL, route); return false; }
    const result = await verifyPayment(signature, minL, route);
    if (!result.ok) { send402(res, minL, route, result.error, result.pending ? signature : undefined); return false; }
    return true;
  } catch (error) {
    if (error instanceof PaymentInputError) res.status(400).json({ error: error.message });
    else { console.error("Payment verification failed:", error); res.status(503).json({ error: "Payment verification temporarily unavailable" }); }
    return false;
  }
}

export const generateApiKey = () => `sm_live_${crypto.randomBytes(20).toString("hex")}`;
