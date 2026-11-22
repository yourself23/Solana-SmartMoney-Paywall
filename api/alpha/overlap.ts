import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall";
import { findWalletOverlap } from "../../lib/smart";
export default async function h(q: VercelRequest, s: VercelResponse) { if (!(await requireGate(q, s, MICRO_LAMPORTS, "/api/alpha/overlap"))) return; const ws = String(q.query.wallets || "").split(",").map(x => x.trim()).filter(Boolean); if (ws.length < 2) return s.status(400).json({ error: "comma-separated wallets required" }); try { s.status(200).json(await findWalletOverlap(ws)); } catch (e) { s.status(500).json({ error: String(e) }); } }
