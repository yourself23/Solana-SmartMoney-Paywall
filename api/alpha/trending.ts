import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getTrendingSmartMints } from "../../lib/smart";
export default async function h(_q: VercelRequest, s: VercelResponse) {
  try { return s.status(200).json(await getTrendingSmartMints()); }
  catch (error) {
    console.error("Trending lookup failed:", error);
    return s.status(200).json({ source: "unavailable", degraded: true, count: 0, trendingMints: [] });
  }
}
