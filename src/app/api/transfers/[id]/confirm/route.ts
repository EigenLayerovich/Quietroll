import { authed, HttpError, ownedTransfer, readJson } from "@/lib/api";
import type { ConfirmBroadcastRequest } from "@/lib/mh";

export const dynamic = "force-dynamic";

const isSig = (s: unknown): s is string => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(s);
const isSigList = (a: unknown): a is string[] => Array.isArray(a) && a.length <= 64 && a.every(isSig);

export const POST = authed(async ({ wallet, api }, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const t = await ownedTransfer(api, wallet, (await params).id);
  const b = await readJson<Record<string, unknown>>(req);

  // Forward only the documented fields, each validated as base58 signatures.
  const body: ConfirmBroadcastRequest = { routeInitSignatures: [] };
  if (b.routeInitSignatures !== undefined) {
    if (!isSigList(b.routeInitSignatures)) throw new HttpError(400, "BAD_REQUEST", "Invalid routeInitSignatures");
    body.routeInitSignatures = b.routeInitSignatures;
  }
  for (const k of ["sessionInitSignatures", "dispersionInitSignatures"] as const) {
    if (b[k] === undefined) continue;
    if (!isSigList(b[k])) throw new HttpError(400, "BAD_REQUEST", `Invalid ${k}`);
    if ((b[k] as string[]).length) body[k] = b[k] as string[];
  }
  for (const k of ["keeperFundingSignature", "orchestratorInitSignature"] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    if (!isSig(b[k])) throw new HttpError(400, "BAD_REQUEST", `Invalid ${k}`);
    body[k] = b[k] as string;
  }
  return api.confirmBroadcast(t.id, body);
});
