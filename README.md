# Solana SmartMoney Paywall

Native SOL & USDC x402 v2 and Streamable HTTP Remote MCP gateway for Solana Mainnet smart-money DEX flow, whale wallet profiling, early-buyer copy-trade discovery, and multi-wallet alpha overlap.

- **Free Discovery Hook:** `GET /api/alpha/trending` & MCP tool `smart_trending_mints`
- **Paid Micro-Calls (`0.005 SOL` / `0.50 USDC`):** `GET /api/alpha/wallet`, `GET /api/alpha/early-buyers`, `GET /api/alpha/overlap`, `POST /api/mcp`
- **Alpha Pass (`0.05 SOL` / `5.00 USDC` = 30 calls):** `POST /api/credits/mint`
- **Treasury:** `2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2`

Set `SOLANA_RPC_URL` to a Solana Mainnet RPC endpoint (default: `https://api.mainnet-beta.solana.com`) and configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for paid calls. `TREASURY_WALLET` overrides the default treasury.

Trending data is DexScreener token boosts, not verified smart-money trades. If the feed fails, the response identifies the degraded state and returns network statistics with an empty mint list. The early-buyers endpoint samples signers from recent mint-address transactions; it does not establish that they bought the token or were the earliest buyers.

Paid calls accept a confirmed transaction signature or a base64 JSON `X-PAYMENT` / `PAYMENT-SIGNATURE` containing a fully signed `payload.transaction`. The latter is broadcast using the configured RPC; if confirmation is pending, retry with the returned `payment_signature`. Prepaid passes are returned once and expire after 30 days. **Transaction signatures are public:** without proof of ownership, another party can redeem an observed payment before its payer. A lost pass response cannot be recovered by retrying.

New replay records do not expire. Records created by older deployments retain their original expiry unless encountered again before expiry; operators must persist those legacy `sm:tx:*` keys before they expire to prevent historical replays. Paid calls are charged before the analytics request runs, so an upstream failure after payment can consume a credit or payment.

Run `npm install`, `npx tsc --noEmit`, and `npm test` on Node 22. Tests mock external services; they do not prove production RPC, Redis, or feed availability. To run the Redis integration test, set `REDIS_TEST_CLI` and `REDIS_TEST_SOCKET` to a **dedicated empty** local Redis instance; the test writes and deletes test records.
