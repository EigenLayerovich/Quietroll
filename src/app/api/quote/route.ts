import { authed, HttpError, readJson } from "@/lib/api";
import { MAX_DESTINATIONS } from "@/lib/batch";
import { quoteRoute, type FeeMode } from "@/lib/quote";
import { cluster, findToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

interface Body {
  tokenMint: string;
  hops: number;
  arrivalSeconds: number;
  feeMode: FeeMode;
  amounts: string[];
}

export const POST = authed(async ({ api }, req: Request) => {
  const b = await readJson<Body>(req);
  const token = findToken(cluster(), b.tokenMint);
  if (!token) throw new HttpError(400, "BAD_REQUEST", "Unsupported token");
  if (!Array.isArray(b.amounts) || b.amounts.length < 1 || b.amounts.length > MAX_DESTINATIONS) {
    throw new HttpError(400, "BAD_REQUEST", `A route pays between 1 and ${MAX_DESTINATIONS} recipients`);
  }
  if (!b.amounts.every((a) => typeof a === "string" && /^[1-9]\d{0,30}$/.test(a))) {
    throw new HttpError(400, "BAD_REQUEST", "Amounts must be positive integers in base units");
  }
  const hops = Number(b.hops);
  const arrivalSeconds = Number(b.arrivalSeconds);
  if (!Number.isInteger(hops) || hops < 3 || hops > 10) throw new HttpError(400, "BAD_REQUEST", "Hops must be 3-10");
  if (!Number.isInteger(arrivalSeconds) || arrivalSeconds < 60 || arrivalSeconds > 2_592_000) {
    throw new HttpError(400, "BAD_REQUEST", "Arrival must be between 1 minute and 30 days");
  }
  return quoteRoute(api, {
    tokenMint: token.mint,
    tokenDecimals: token.decimals,
    hops,
    arrivalSeconds,
    feeMode: b.feeMode === "deducted" ? "deducted" : "on_top",
    amounts: b.amounts.map(BigInt),
  });
});
