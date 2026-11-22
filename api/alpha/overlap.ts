import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasPayment, MICRO_LAMPORTS, requireGate, send402 } from "../../lib/paywall";
import { findWalletOverlap, InputError, requireWallets } from "../../lib/smart";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = typeof req.query.wallets === "string" ? req.query.wallets.trim() : "";
  if (!raw && !hasPayment(req)) return send402(res, MICRO_LAMPORTS, "/api/alpha/overlap");
  let wallets: string[];
  try { wallets = requireWallets(raw.split(",").map((wallet) => wallet.trim())); }
  catch (error) { return res.status(400).json({ error: error instanceof InputError ? error.message : "Invalid wallets" }); }
  if (!hasPayment(req)) return send402(res, MICRO_LAMPORTS, "/api/alpha/overlap");
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/alpha/overlap"))) return;
  try { return res.status(200).json(await findWalletOverlap(wallets)); }
  catch (error) { console.error("Wallet overlap failed:", error); return res.status(503).json({ error: "Wallet overlap unavailable" }); }
}
