import { authed, HttpError, readJson } from "@/lib/api";
import { MAX_DESTINATIONS, fromRaw, isValidWallet, parseExternalId } from "@/lib/batch";
import { MhError, type Transfer } from "@/lib/mh";
import { cluster, findToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

interface Body {
  tokenMint: string;
  externalId: string;
  hops: number;
  arrivalSeconds: number;
  amountRaw: string;
  destinations: { wallet: string; amountRaw: string }[];
}

/** Create (or idempotently fetch) one payout route owned by the session wallet. */
export const POST = authed(async ({ wallet, api }, req: Request) => {
  const b = await readJson<Body>(req);
  const token = findToken(cluster(), b.tokenMint);
  if (!token) throw new HttpError(400, "BAD_REQUEST", "Unsupported token");
  if (!parseExternalId(b.externalId)) throw new HttpError(400, "BAD_REQUEST", "Invalid external id");
  const d = b.destinations;
  if (!Array.isArray(d) || d.length < 1 || d.length > MAX_DESTINATIONS) {
    throw new HttpError(400, "BAD_REQUEST", `A route pays between 1 and ${MAX_DESTINATIONS} recipients`);
  }
  if (!d.every((x) => isValidWallet(x.wallet) && /^[1-9]\d{0,30}$/.test(x.amountRaw))) {
    throw new HttpError(400, "BAD_REQUEST", "Every destination needs a valid wallet and a positive amount");
  }
  if (new Set(d.map((x) => x.wallet)).size !== d.length) {
    throw new HttpError(400, "BAD_REQUEST", "Destination wallets must be distinct");
  }
  const total = d.reduce((a, x) => a + BigInt(x.amountRaw), 0n);
  if (total.toString() !== b.amountRaw) {
    throw new HttpError(400, "BAD_REQUEST", "Destination shares must sum to the route amount");
  }

  try {
    return await api.createTransfer({
      tokenMint: token.mint,
      tokenDecimals: token.decimals,
      tokenSymbol: token.symbol,
      amountRaw: b.amountRaw,
      amountTokens: fromRaw(b.amountRaw, token.decimals),
      // Always the authenticated wallet - never taken from the request body.
      sourceOwner: wallet,
      hops: Number(b.hops),
      arrivalSeconds: Number(b.arrivalSeconds),
      externalId: b.externalId,
      ...(d.length === 1 ? { recipientWallet: d[0].wallet } : { destinations: d }),
    });
  } catch (e) {
    // Duplicate external id: this route already exists, so return it rather
    // than creating a second payout. Only its owner may see it.
    if (e instanceof MhError && e.code === "MH_033") {
      const existing = await api.getByExternalId(b.externalId);
      if (existing.sourceOwner === wallet) return existing;
      throw new HttpError(409, "CONFLICT", "This run id is taken. Start a new run.");
    }
    throw e;
  }
});

/** The signed-in wallet's recent routes, newest first. */
export const GET = authed(async ({ wallet, api }) => {
  const mine: Transfer[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const page = await api.listTransfers({ limit: pageSize, offset });
    mine.push(...page.items.filter((t) => t.sourceOwner === wallet));
    if (offset + pageSize >= page.pagination.total || page.items.length === 0) break;
  }
  return { items: mine };
});
