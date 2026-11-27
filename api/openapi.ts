import type { VercelRequest, VercelResponse } from "@vercel/node";
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    openapi: "3.1.0",
    info: {
      title: "Solana SmartMoney Paywall",
      version: "1.0.0",
      description: "Real-time Solana alpha feeds for early buyers, wallet overlap, and smart-money tracking gated with x402 v2 Solana USDC/SOL micropayments.",
      contact: { name: "Willstone Nexus Systems", email: "timothyhuff25@gmail.com" },
      "x-guidance": "Pay per call via x402 v2 using Solana Mainnet USDC or SOL to treasury 5Y7aEmYpCyMJanR9qjCUYf59voi6EsJrkjsJB2cNMsW."
    },
    tags: [{ name: "solana" }, { name: "market-data" }, { name: "analytics" }],
    components: { securitySchemes: { x402: { type: "apiKey", in: "header", name: "X-PAYMENT" } } },
    paths: {
      "/api/alpha/trending": { get: { summary: "Trending Solana token boosts (Free)", security: [], responses: { "200": { description: "OK" } } } },
      "/api/alpha/wallet": { get: { summary: "Smart-money wallet profile ($0.50 USDC / 0.005 SOL)", security: [{ x402: [] }], responses: { "402": { description: "Payment Required" } } } },
      "/api/alpha/early-buyers": { get: { summary: "Early buyers for a Solana mint ($0.50 USDC / 0.005 SOL)", security: [{ x402: [] }], responses: { "402": { description: "Payment Required" } } } },
      "/api/alpha/overlap": { get: { summary: "Shared token holdings across wallets ($0.50 USDC / 0.005 SOL)", security: [{ x402: [] }], responses: { "402": { description: "Payment Required" } } } },
      "/api/credits/mint": { post: { summary: "Mint 30 API credits ($5.00 USDC / 0.05 SOL)", security: [{ x402: [] }], responses: { "402": { description: "Payment Required" } } } }
    }
  });
}
