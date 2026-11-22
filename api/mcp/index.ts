import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasPayment, MICRO_LAMPORTS, requireGate, send402 } from "../../lib/paywall";
import { findEarlyBuyers, findWalletOverlap, getTrendingSmartMints, InputError, profileWallet, requireAddress, requireWallets } from "../../lib/smart";

const TOOLS = [
  { name: "smart_trending_mints", description: "Free Solana token boosts", inputSchema: { type: "object", properties: {} } },
  { name: "smart_wallet_profile", description: "Wallet SOL, SPL positions and recent transaction success rate (0.005 SOL / 0.50 USDC)", inputSchema: { type: "object", properties: { wallet: { type: "string" } }, required: ["wallet"] } },
  { name: "smart_early_buyers", description: "Signers of a sample of recent mint transactions (0.005 SOL / 0.50 USDC)", inputSchema: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } },
  { name: "smart_wallet_overlap", description: "Shared token holdings across 2 to 5 distinct wallets (0.005 SOL / 0.50 USDC)", inputSchema: { type: "object", properties: { wallets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5, uniqueItems: true } }, required: ["wallets"] } },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ name: "solana-smartmoney-paywall", protocol: "MCP Streamable HTTP JSON-RPC 2.0", free_tools: ["smart_trending_mints"], tools: TOOLS });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  }
  const { id = null, method, params } = body;
  if (!("id" in body)) return res.status(202).end();
  if (method === "initialize") return res.status(200).json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "solana-smartmoney-paywall", version: "1.0.0" } } });
  if (method === "ping") return res.status(200).json({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return res.status(200).json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method !== "tools/call") return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported method" } });
  const name = params?.name;
  if (!TOOLS.some((tool) => tool.name === name)) return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
  const args = params?.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid arguments" } });
  try {
    let execute: () => Promise<unknown>;
    if (name === "smart_trending_mints") execute = getTrendingSmartMints;
    else {
      if (!hasPayment(req) && args.wallet === undefined && args.mint === undefined && args.wallets === undefined) return send402(res, MICRO_LAMPORTS, "/api/mcp");
      if (name === "smart_wallet_profile") {
        const wallet = requireAddress(args.wallet, "wallet");
        execute = () => profileWallet(wallet);
      } else if (name === "smart_early_buyers") {
        const mint = requireAddress(args.mint, "mint");
        execute = () => findEarlyBuyers(mint);
      } else {
        const wallets = requireWallets(args.wallets);
        execute = () => findWalletOverlap(wallets);
      }
      if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/mcp"))) return;
    }
    const data = await execute();
    return res.status(200).json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: error.message } });
    console.error("MCP tool failed:", error);
    return res.status(503).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool temporarily unavailable" } });
  }
}
