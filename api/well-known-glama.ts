import type { VercelRequest, VercelResponse } from "@vercel/node";
export default function h(_q: VercelRequest, s: VercelResponse) { s.status(200).json({ $schema: "https://glama.ai", maintainers: ["yourself23"] }); }
