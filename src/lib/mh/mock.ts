// DEMO MODE simulator. Used only when MH_API_KEY is not set, so the product
// can be explored end to end without a key or funds. It mirrors the published
// fee schedule and status lifecycle but moves no value and touches no chain.

import { SOL_MINT } from "../tokens";
import {
  MhError,
  type ConfirmBroadcastRequest,
  type CreateTransferRequest,
  type EstimateRequest,
  type FeeEstimate,
  type MhApi,
  type PrepareResponse,
  type Transfer,
  type TransferList,
  type UsageSummary,
} from "./types";

const PERCENT_FEE_BPS = 50;
const FLAT_PER_HOP = 2_000_000; // top tier of the published schedule
const SCREENING_PER_WALLET = 2_000_000;
const HOP_MS = 2_500;
const PAYOUT_MS = 700;

interface Sim {
  transfer: Transfer;
  keeperFunded: boolean;
  startedAt: number | null;
}

function fakeSig(seed: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < 64; i++) {
    for (const ch of seed + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out += alphabet[Math.abs(h) % alphabet.length];
  }
  return `demo${out}`;
}

export class MockMhApi implements MhApi {
  readonly mock = true;
  private sims = new Map<number, Sim>();
  private nextId = 1001;

  private quote(amountRaw: bigint, isSol: boolean, hops: number) {
    const flat = BigInt(FLAT_PER_HOP * hops);
    // Fee is charged on the delivered amount: hop + floor(hop*bps/1e4) <= spendable.
    const spendable = isSol ? amountRaw - flat : amountRaw;
    if (spendable <= 0n) throw new MhError("MH_016", "Amount does not cover the fee", 400);
    let hop = (spendable * 10_000n) / BigInt(10_000 + PERCENT_FEE_BPS);
    while (hop + (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n < spendable) hop += 1n;
    while (hop + (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n > spendable) hop -= 1n;
    return { hop, fee: (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n, flat };
  }

  async estimate(req: EstimateRequest): Promise<FeeEstimate> {
    const hops = req.hops ?? 3;
    if (hops < 3 || hops > 10) throw new MhError("MH_013", "Hops out of range (3-10)", 400);
    const isSol = req.tokenMint === SOL_MINT;
    const q = this.quote(BigInt(req.amountRaw), isSol, hops);
    const dests = req.destinationCount ?? 1;
    const screening = SCREENING_PER_WALLET * (hops + 1 + dests);
    const rent = 29_000_000 + 2_100_000 * dests;
    return {
      tier: "tier_9",
      percentFeeBps: PERCENT_FEE_BPS,
      percentFeeRaw: q.fee.toString(),
      totalFlatFeeLamports: Number(q.flat),
      hopAmountRaw: q.hop.toString(),
      priceSource: "demo",
      cappedAtTierBoundary: false,
      sol: {
        requiredSolUpFrontLamports: rent + screening + Number(q.flat) + 50_000,
        refundableLamports: rent - 3_000_000,
        breakdown: { screeningFeeLamports: screening, protocolFlatFeeLamports: Number(q.flat) },
      },
      isTestMode: true,
    };
  }

  async createTransfer(req: CreateTransferRequest): Promise<Transfer> {
    if (req.externalId) {
      for (const s of this.sims.values()) {
        if (s.transfer.externalId === req.externalId) return this.view(s);
      }
    }
    const hops = req.hops ?? 3;
    const isSol = req.tokenMint === SOL_MINT;
    const q = this.quote(BigInt(req.amountRaw), isSol, hops);
    let destinations: Transfer["destinations"] = null;
    if (req.destinations) {
      if (req.destinations.length < 1 || req.destinations.length > 20) {
        throw new MhError("MH_017", "Between 1 and 20 destinations are allowed", 400);
      }
      const total = req.destinations.reduce((a, d) => a + BigInt(d.amountRaw), 0n);
      if (total !== BigInt(req.amountRaw)) {
        throw new MhError("MH_017", "Destination shares must sum to amountRaw exactly", 400);
      }
      let assigned = 0n;
      destinations = req.destinations.map((d, i, all) => {
        const amt = i === all.length - 1 ? q.hop - assigned : (BigInt(d.amountRaw) * q.hop) / total;
        assigned += amt;
        return { wallet: d.wallet, amountRaw: amt.toString(), status: "pending", payoutSignature: null, paidAt: null };
      });
    }
    const id = this.nextId++;
    const now = new Date();
    const transfer: Transfer = {
      id,
      externalId: req.externalId ?? null,
      supportBundleId: `MH-demo-${id}`,
      tokenMint: req.tokenMint,
      tokenSymbol: req.tokenSymbol ?? null,
      amountRaw: req.amountRaw,
      amountTokens: req.amountTokens,
      sourceOwner: req.sourceOwner,
      recipientWallet: req.recipientWallet ?? null,
      destinationCount: destinations?.length ?? null,
      destinations,
      hops,
      arrivalSeconds: req.arrivalSeconds ?? 300,
      percentFeeBps: PERCENT_FEE_BPS,
      percentFeeRaw: q.fee.toString(),
      totalFlatFeeLamports: Number(q.flat),
      recipientReceivesRaw: q.hop.toString(),
      status: "quote",
      phase: "quoted",
      progress: { hopsCompleted: 0, hopsTotal: hops },
      lastError: null,
      signatures: { routeInit: [], sessionInit: [], hops: [] },
      isTest: true,
      createdAt: now.toISOString(),
      completedAt: null,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    };
    this.sims.set(id, { transfer, keeperFunded: false, startedAt: null });
    return this.view(this.sims.get(id)!);
  }

  private sim(id: number): Sim {
    const s = this.sims.get(id);
    if (!s) throw new MhError("MH_030", "Transfer not found", 404);
    return s;
  }

  /** Advance the simulated lifecycle from wall-clock time since activation. */
  private view(s: Sim): Transfer {
    const t = s.transfer;
    if (s.startedAt !== null) {
      const elapsed = Date.now() - s.startedAt;
      const hopsDone = Math.min(t.hops, Math.floor(elapsed / HOP_MS));
      t.progress = { hopsCompleted: hopsDone, hopsTotal: t.hops };
      t.signatures!.hops = Array.from({ length: hopsDone }, (_, i) => fakeSig(`${t.id}h${i}`));
      const afterHops = elapsed - t.hops * HOP_MS;
      if (hopsDone < t.hops) {
        t.status = elapsed < 1500 ? "processing" : "active";
        t.phase = "executing";
      } else if (t.destinations) {
        const paid = Math.min(t.destinations.length, Math.floor(afterHops / PAYOUT_MS));
        t.destinations.forEach((d, i) => {
          if (i < paid && d.status !== "paid") {
            d.status = "paid";
            d.payoutSignature = fakeSig(`${t.id}p${i}`);
            d.paidAt = new Date(s.startedAt! + t.hops * HOP_MS + (i + 1) * PAYOUT_MS).toISOString();
          }
        });
        const done = paid === t.destinations.length;
        t.status = done ? "completed" : "active";
        t.phase = done ? "settled" : "executing";
        if (done && !t.completedAt) t.completedAt = new Date().toISOString();
      } else {
        t.status = "completed";
        t.phase = "settled";
        if (!t.completedAt) t.completedAt = new Date().toISOString();
      }
    }
    return structuredClone(t);
  }

  async prepare(id: number): Promise<PrepareResponse> {
    const s = this.sim(id);
    if (["completed", "refunded", "expired"].includes(s.transfer.status)) {
      throw new MhError("MH_035", "Transfer not in a state that allows this operation", 409);
    }
    const started = s.startedAt !== null;
    if (!started) {
      s.transfer.status = "awaiting_signature";
      s.transfer.phase = "deploying";
    }
    return {
      transfer: this.view(s),
      preparedTxs: {
        keeperFundingTx: s.keeperFunded || started ? null : "DEMO",
        routeInitTxs: started ? [] : [{ base64: "DEMO" }],
        orchestratorInitTx: started ? null : "DEMO",
        sessionInitTxs: started ? [] : ["DEMO", "DEMO"],
        dispersionInitTxs: started || !s.transfer.destinations ? [] : ["DEMO"],
        recentBlockhash: "demo",
        lastValidBlockHeight: 0,
        resume: { nothingToDo: started, routeAlreadyDeployed: started },
      },
    };
  }

  async confirmBroadcast(id: number, body: ConfirmBroadcastRequest): Promise<Transfer> {
    const s = this.sim(id);
    if (body.keeperFundingSignature) s.keeperFunded = true;
    if (body.routeInitSignatures.length > 0) {
      if (!s.keeperFunded) throw new MhError("MH_039", "keeperFundingSignature is required", 400);
      if (s.transfer.destinations && !body.dispersionInitSignatures?.length) {
        throw new MhError("MH_041", "Destinations not yet bound on chain", 409);
      }
      s.transfer.signatures!.routeInit = body.routeInitSignatures;
      s.transfer.signatures!.sessionInit = body.sessionInitSignatures ?? [];
      if (s.startedAt === null) s.startedAt = Date.now();
    }
    return this.view(s);
  }

  async getTransfer(id: number): Promise<Transfer> {
    return this.view(this.sim(id));
  }

  async getByExternalId(externalId: string): Promise<Transfer> {
    for (const s of this.sims.values()) {
      if (s.transfer.externalId === externalId) return this.view(s);
    }
    throw new MhError("MH_030", "Transfer not found", 404);
  }

  async listTransfers(q: { limit?: number; offset?: number }): Promise<TransferList> {
    const all = [...this.sims.values()].map((s) => this.view(s)).reverse();
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    return { items: all.slice(offset, offset + limit), pagination: { total: all.length, limit, offset } };
  }

  async usage(): Promise<UsageSummary> {
    const all = [...this.sims.values()].map((s) => this.view(s));
    return {
      totalTransfers: all.length,
      completedTransfers: all.filter((t) => t.status === "completed").length,
      failedTransfers: 0,
      totalVolumeRaw: all.reduce((a, t) => a + BigInt(t.amountRaw), 0n).toString(),
      totalFlatFeeEarned: 0,
      tokenFeesEarned: [],
      totalPayouts: 0,
      isTestMode: true,
    };
  }
}
