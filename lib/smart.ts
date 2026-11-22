import { solRpc } from "./paywall";

const SKIP = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class InputError extends Error {}

export function validAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let number = 0n;
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return false;
    number = number * 58n + BigInt(digit);
  }
  let bytes = 0;
  for (; number > 0n; number >>= 8n) bytes++;
  return bytes + (value.match(/^1*/)?.[0].length || 0) === 32;
}

export function requireAddress(value: unknown, name: string): string {
  if (!validAddress(value)) throw new InputError(`${name} must be a valid Solana public key`);
  return value;
}

export function requireWallets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) throw new InputError("Provide 2 to 5 distinct wallets");
  const wallets = value.map((wallet) => requireAddress(wallet, "wallet"));
  if (new Set(wallets).size !== wallets.length) throw new InputError("Provide 2 to 5 distinct wallets");
  return wallets;
}

export async function getTrendingSmartMints() {
  try {
    const response = await fetch("https://api.dexscreener.com/token-boosts/top/v1", { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`DexScreener HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid DexScreener response");
    const seen = new Set<string>();
    const mints = data.filter((item) => {
      if (item?.chainId !== "solana" || !validAddress(item.tokenAddress) || seen.has(item.tokenAddress)) return false;
      seen.add(item.tokenAddress);
      return true;
    }).slice(0, 10).map((item) => ({ mint: item.tokenAddress, totalBoostAmount: typeof item.totalAmount === "number" && Number.isFinite(item.totalAmount) ? item.totalAmount : 0, url: item.url }));
    return { source: "dexscreener-token-boosts", count: mints.length, trendingMints: mints };
  } catch (error) {
    console.warn("Trending feed unavailable:", error instanceof Error ? error.message : error);
    try {
      const [samples, supply] = await Promise.all([solRpc("getRecentPerformanceSamples", [1]), solRpc("getSupply", [])]);
      return { source: "solana-mainnet-rpc", degraded: true, count: 0, trendingMints: [], network: { performanceSamples: Array.isArray(samples) ? samples : [], supply: supply?.value ?? null } };
    } catch (rpcError) {
      console.warn("Trending RPC fallback unavailable:", rpcError instanceof Error ? rpcError.message : rpcError);
      return { source: "unavailable", degraded: true, count: 0, trendingMints: [] };
    }
  }
}

export async function profileWallet(wallet: string) {
  const w = requireAddress(wallet, "wallet");
  const [bal, tok, sigs] = await Promise.all([solRpc("getBalance", [w]), solRpc("getTokenAccountsByOwner", [w, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]), solRpc("getSignaturesForAddress", [w, { limit: 25 }])]);
  const positions = (Array.isArray(tok?.value) ? tok.value : []).map((t: any) => ({ mint: t.account?.data?.parsed?.info?.mint, uiAmount: t.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0 })).filter((h: any) => h.uiAmount > 0);
  const signatures = Array.isArray(sigs) ? sigs : [];
  const ok = signatures.filter((s: any) => s && !s.err).length;
  return { wallet: w, solBalance: Number(((bal?.value ?? 0) / 1e9).toFixed(4)), activeSplPositions: positions.length, recentTxCount: signatures.length, successRatePct: signatures.length ? Number(((ok / signatures.length) * 100).toFixed(1)) : 0, topPositions: positions.slice(0, 12) };
}

export async function findEarlyBuyers(value: string) {
  const mint = requireAddress(value, "mint");
  const result = await solRpc("getSignaturesForAddress", [mint, { limit: 40 }]);
  const signatures = Array.isArray(result) ? result : [];
  const out: { wallet: string; slot: number; signature: string }[] = [], seen = new Set<string>();
  for (const s of signatures.filter((x: any) => x && !x.err && typeof x.signature === "string").slice(-8).reverse()) {
    const tx = await solRpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    const keys = tx?.transaction?.message?.accountKeys;
    const wallet = Array.isArray(keys) ? keys.find((a: any) => a && a.signer)?.pubkey : undefined;
    if (validAddress(wallet) && !seen.has(wallet)) { seen.add(wallet); out.push({ wallet, slot: s.slot, signature: s.signature }); }
  }
  return { mint, earliestBuyers: out };
}

export async function findWalletOverlap(value: string[]) {
  const wallets = requireWallets(value);
  const lists = await Promise.all(wallets.map(async (w) => {
    const tok = await solRpc("getTokenAccountsByOwner", [w, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]);
    return new Set<string>((Array.isArray(tok?.value) ? tok.value : []).filter((t: any) => (t.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0) > 0).map((t: any) => t.account?.data?.parsed?.info?.mint).filter((x: unknown): x is string => validAddress(x) && !SKIP.has(x)));
  }));
  const counts = new Map<string, number>();
  for (const set of lists) for (const mint of set) counts.set(mint, (counts.get(mint) || 0) + 1);
  return { comparedWallets: wallets, sharedAlphaMints: [...counts.entries()].filter(([, count]) => count >= 2).map(([mint, walletCount]) => ({ mint, walletCount })).sort((a, b) => b.walletCount - a.walletCount) };
}
