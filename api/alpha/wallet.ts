import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasPayment, MICRO_LAMPORTS, requireGate, send402 } from "../../lib/paywall";
import { profileWallet, validAddress } from "../../lib/smart";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (wallet && !validAddress(wallet)) return res.status(400).json({ error: "wallet must be a valid Solana public key" });
  if (!hasPayment(req)) return send402(res, MICRO_LAMPORTS, "/api/alpha/wallet");
  if (!validAddress(wallet)) return res.status(400).json({ error: "wallet must be a valid Solana public key" });
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/alpha/wallet"))) return;
  try { return res.status(200).json(await profileWallet(wallet)); }
  catch (error) { console.error("Wallet profile failed:", error); return res.status(503).json({ error: "Wallet profile unavailable" }); }
}
