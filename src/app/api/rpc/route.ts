import { authed, HttpError, readJson } from "@/lib/api";
import { mh } from "@/lib/mh";

export const dynamic = "force-dynamic";

// The browser broadcasts through this proxy so the RPC key stays server-side
// and public-endpoint CORS limits do not apply. Only what the payout flow
// needs is allowed; it is not a general-purpose RPC.
const ALLOWED = new Set(["sendTransaction", "getSignatureStatuses", "getBalance", "getTokenAccountsByOwner"]);

export const POST = authed(async (_ctx, req: Request) => {
  if (mh().mock) throw new HttpError(400, "DEMO_MODE", "No chain access in demo mode");
  const url = process.env.SOLANA_RPC_URL?.trim();
  // Must be a full endpoint URL. A bare provider API key is a common mistake.
  if (!url || !/^https:\/\/\S+$/.test(url) || !URL.canParse(url)) {
    throw new HttpError(500, "CONFIG", "SOLANA_RPC_URL is missing or is not a full https:// RPC URL. Fix it in the server settings and redeploy.");
  }
  const b = await readJson<{ method?: string; params?: unknown[] }>(req);
  if (!b.method || !ALLOWED.has(b.method)) throw new HttpError(400, "BAD_REQUEST", "RPC method not allowed");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: b.method, params: b.params ?? [] }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new HttpError(502, "RPC_ERROR", `Solana RPC returned HTTP ${res.status}`);
  return res.json();
});
