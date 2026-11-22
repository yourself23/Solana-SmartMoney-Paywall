import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getTrendingSmartMints } from "../../lib/smart";
export default async function h(_q: VercelRequest, s: VercelResponse) { try { s.status(200).json(await getTrendingSmartMints()); } catch (e) { s.status(500).json({ error: String(e) }); } }
