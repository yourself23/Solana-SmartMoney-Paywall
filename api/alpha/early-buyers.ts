import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall";
import { findEarlyBuyers } from "../../lib/smart";
export default async function h(q: VercelRequest, s: VercelResponse) { if (!(await requireGate(q, s, MICRO_LAMPORTS, "/api/alpha/early-buyers"))) return; const m = String(q.query.mint || "").trim(); if (!m) return s.status(400).json({ error: "mint required" }); try { s.status(200).json(await findEarlyBuyers(m)); } catch (e) { s.status(500).json({ error: String(e) }); } }
