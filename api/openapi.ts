import type { VercelRequest, VercelResponse } from "@vercel/node";
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    openapi: "3.1.0",
    info: { title: "Solana SmartMoney Paywall", version: "1.0.0", description: "Real-time Solana alpha feeds for early buyers, wallet overlap, and smart-money tracking gated with x402 v2 Solana USDC/SOL micropayments." },
    tags: [{ name: "solana" }, { name: "market-data" }, { name: "analytics" }],
    paths: {
      "/api/alpha/trending": { get: { summary: "Trending Solana token boosts (Free)", security: [], responses: { "200": { description: "OK" } } } },
      "/api/alpha/wallet": { get: { summary: "Smart-money wallet profile ($0.50 USDC / 0.005 SOL)", responses: { "402": { description: "Payment Required" } } } },
      "/api/alpha/early-buyers": { get: { summary: "Early buyers for a Solana mint ($0.50 USDC / 0.005 SOL)", responses: { "402": { description: "Payment Required" } } } },
      "/api/alpha/overlap": { get: { summary: "Shared token holdings across wallets ($0.50 USDC / 0.005 SOL)", responses: { "402": { description: "Payment Required" } } } },
      "/api/credits/mint": { post: { summary: "Mint 30 API credits ($5.00 USDC / 0.05 SOL)", responses: { "402": { description: "Payment Required" } } } }
    }
  });
}
