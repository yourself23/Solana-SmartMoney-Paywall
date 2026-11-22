import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PASS_CREDITS, PASS_LAMPORTS, TREASURY, generateApiKey, PaymentInputError, resolveSig, send402, verifyPayment } from "../../lib/paywall";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const signature = await resolveSig(req);
    if (!signature) return send402(res, PASS_LAMPORTS, "/api/credits/mint");
    const apiKey = generateApiKey();
    const result = await verifyPayment(signature, PASS_LAMPORTS, "/api/credits/mint", apiKey);
    if (!result.ok) return send402(res, PASS_LAMPORTS, "/api/credits/mint", result.error, result.pending ? signature : undefined);
    return res.status(200).json({ apiKey, credits: PASS_CREDITS, treasury: TREASURY });
  } catch (error) {
    if (error instanceof PaymentInputError) return res.status(400).json({ error: error.message });
    console.error("Pass issuance failed:", error);
    return res.status(503).json({ error: "Payment verification temporarily unavailable" });
  }
}
