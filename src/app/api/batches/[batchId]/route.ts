import { authed, HttpError } from "@/lib/api";
import { externalIdFor } from "@/lib/batch";
import { MhError, type Transfer } from "@/lib/mh";

export const dynamic = "force-dynamic";

/**
 * All routes of one payout run. Runs are not stored anywhere by this app:
 * they are reconstructed from MultiHopper by their deterministic external
 * ids, so a run can be reopened from any device with the same wallet.
 */
export const GET = authed(
  async ({ wallet, api }, req: Request, { params }: { params: Promise<{ batchId: string }> }) => {
    const { batchId } = await params;
    if (!/^[a-z0-9]{10}$/.test(batchId)) throw new HttpError(400, "BAD_REQUEST", "Invalid run id");
    // The browser passes how many routes it expects; otherwise probe until a gap.
    const hint = Number(new URL(req.url).searchParams.get("count")) || 0;
    const max = Math.min(hint > 0 ? hint : 50, 50);

    const transfers: (Transfer | null)[] = [];
    for (let i = 0; i < max; i++) {
      try {
        const t = await api.getByExternalId(externalIdFor(batchId, i));
        transfers.push(t.sourceOwner === wallet ? t : null);
      } catch (e) {
        if (e instanceof MhError && e.code === "MH_030") {
          if (hint > 0) transfers.push(null);
          else break;
        } else throw e;
      }
    }
    return { batchId, transfers };
  },
);
