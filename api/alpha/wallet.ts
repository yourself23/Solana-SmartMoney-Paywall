import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall";
import { profileWallet } from "../../lib/smart";
export default async function h(q: VercelRequest, s: VercelResponse) { if (!(await requireGate(q, s, MICRO_LAMPORTS, "/api/alpha/wallet"))) return; const w = String(q.query.wallet || "").trim(); if (!w) return s.status(400).json({ error: "wallet required" }); try { s.status(200).json(await profileWallet(w)); } catch (e) { s.status(500).json({ error: String(e) }); } }
