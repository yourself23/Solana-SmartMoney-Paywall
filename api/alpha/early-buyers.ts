import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasPayment, MICRO_LAMPORTS, requireGate, send402 } from "../../lib/paywall";
import { findEarlyBuyers, validAddress } from "../../lib/smart";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mint = typeof req.query.mint === "string" ? req.query.mint.trim() : "";
  if (mint && !validAddress(mint)) return res.status(400).json({ error: "mint must be a valid Solana public key" });
  if (!hasPayment(req)) return send402(res, MICRO_LAMPORTS, "/api/alpha/early-buyers");
  if (!validAddress(mint)) return res.status(400).json({ error: "mint must be a valid Solana public key" });
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/alpha/early-buyers"))) return;
  try { return res.status(200).json(await findEarlyBuyers(mint)); }
  catch (error) { console.error("Early buyer lookup failed:", error); return res.status(503).json({ error: "Early buyer lookup unavailable" }); }
}
