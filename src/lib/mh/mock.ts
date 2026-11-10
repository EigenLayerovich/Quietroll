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

/**
 * The minimum needed to rebuild a simulated transfer. Everything else (fees,
 * status, hop progress, payouts) is derived from this and the clock, so the
 * simulator holds no state of its own between requests.
 */
export interface SimState {
  id: number;
  externalId: string | null;
  tokenMint: string;
  tokenSymbol: string | null;
  amountRaw: string;
  amountTokens: string;
  sourceOwner: string;
  recipientWallet: string | null;
  /** [wallet, share of amountRaw] per destination, or null for one recipient. */
  destinations: [string, string][] | null;
  hops: number;
  arrivalSeconds: number;
  createdAt: number;
  keeperFunded: boolean;
  startedAt: number | null;
}

/** Where simulated transfers are kept. Must not rely on server memory in production. */
export interface SimStore {
  all(): Promise<SimState[]>;
  put(state: SimState): Promise<void>;
}

/** In-process store, for unit tests. */
export class MemorySimStore implements SimStore {
  private sims = new Map<number, SimState>();
  async all() {
    return [...this.sims.values()].map((s) => structuredClone(s));
  }
  async put(state: SimState) {
    this.sims.set(state.id, structuredClone(state));
  }
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

function quote(amountRaw: bigint, isSol: boolean, hops: number) {
  const flat = BigInt(FLAT_PER_HOP * hops);
  // Fee is charged on the delivered amount: hop + floor(hop*bps/1e4) <= spendable.
  const spendable = isSol ? amountRaw - flat : amountRaw;
  if (spendable <= 0n) throw new MhError("MH_016", "Amount does not cover the fee", 400);
  let hop = (spendable * 10_000n) / BigInt(10_000 + PERCENT_FEE_BPS);
  while (hop + (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n < spendable) hop += 1n;
  while (hop + (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n > spendable) hop -= 1n;
  return { hop, fee: (hop * BigInt(PERCENT_FEE_BPS)) / 10_000n, flat };
}

/** Rebuild the full transfer, advancing its lifecycle from the time since activation. */
export function viewTransfer(s: SimState, now = Date.now()): Transfer {
  const q = quote(BigInt(s.amountRaw), s.tokenMint === SOL_MINT, s.hops);
  const elapsed = s.startedAt === null ? -1 : now - s.startedAt;
  const hopsDone = elapsed < 0 ? 0 : Math.min(s.hops, Math.floor(elapsed / HOP_MS));
  const hopsEnd = (s.startedAt ?? 0) + s.hops * HOP_MS;

  let destinations: Transfer["destinations"] = null;
  let paid = 0;
  if (s.destinations) {
    const total = BigInt(s.amountRaw);
    const count = s.destinations.length;
    paid = hopsDone < s.hops ? 0 : Math.min(count, Math.floor((elapsed - s.hops * HOP_MS) / PAYOUT_MS));
    let assigned = 0n;
    destinations = s.destinations.map(([wallet, share], i) => {
      const amt = i === count - 1 ? q.hop - assigned : (BigInt(share) * q.hop) / total;
      assigned += amt;
      const isPaid = i < paid;
      return {
        wallet,
        amountRaw: amt.toString(),
        status: isPaid ? "paid" : "pending",
        payoutSignature: isPaid ? fakeSig(`${s.id}p${i}`) : null,
        paidAt: isPaid ? new Date(hopsEnd + (i + 1) * PAYOUT_MS).toISOString() : null,
      };
    });
  }

  const done = hopsDone === s.hops && (!s.destinations || paid === s.destinations.length);
  const status: Transfer["status"] =
    s.startedAt === null ? "quote" : done ? "completed" : elapsed < 1500 ? "processing" : "active";

  return {
    id: s.id,
    externalId: s.externalId,
    supportBundleId: `MH-demo-${s.id}`,
    tokenMint: s.tokenMint,
    tokenSymbol: s.tokenSymbol,
    amountRaw: s.amountRaw,
    amountTokens: s.amountTokens,
    sourceOwner: s.sourceOwner,
    recipientWallet: s.recipientWallet,
    destinationCount: s.destinations?.length ?? null,
    destinations,
    hops: s.hops,
    arrivalSeconds: s.arrivalSeconds,
    percentFeeBps: PERCENT_FEE_BPS,
    percentFeeRaw: q.fee.toString(),
    totalFlatFeeLamports: Number(q.flat),
    recipientReceivesRaw: q.hop.toString(),
    status,
    phase: s.startedAt === null ? "quoted" : done ? "settled" : "executing",
    progress: { hopsCompleted: hopsDone, hopsTotal: s.hops },
    lastError: null,
    signatures: {
      routeInit: s.startedAt === null ? [] : [fakeSig(`${s.id}r`)],
      sessionInit: [],
      hops: Array.from({ length: hopsDone }, (_, i) => fakeSig(`${s.id}h${i}`)),
    },
    isTest: true,
    createdAt: new Date(s.createdAt).toISOString(),
    completedAt: done
      ? new Date(hopsEnd + (s.destinations?.length ?? 0) * PAYOUT_MS).toISOString()
      : null,
    expiresAt: new Date(s.createdAt + 30 * 60_000).toISOString(),
  };
}

export class MockMhApi implements MhApi {
  readonly mock = true;

  constructor(private store: SimStore = new MemorySimStore()) {}

  private async find(pred: (s: SimState) => boolean): Promise<SimState> {
    const s = (await this.store.all()).find(pred);
    if (!s) throw new MhError("MH_030", "Transfer not found", 404);
    return s;
  }

  async estimate(req: EstimateRequest): Promise<FeeEstimate> {
    const hops = req.hops ?? 3;
    if (hops < 3 || hops > 10) throw new MhError("MH_013", "Hops out of range (3-10)", 400);
    const q = quote(BigInt(req.amountRaw), req.tokenMint === SOL_MINT, hops);
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
    const existing = await this.store.all();
    if (req.externalId) {
      const dup = existing.find((s) => s.externalId === req.externalId);
      if (dup) return viewTransfer(dup);
    }
    const hops = req.hops ?? 3;
    quote(BigInt(req.amountRaw), req.tokenMint === SOL_MINT, hops); // validates the amount covers fees
    if (req.destinations) {
      if (req.destinations.length < 1 || req.destinations.length > 20) {
        throw new MhError("MH_017", "Between 1 and 20 destinations are allowed", 400);
      }
      const total = req.destinations.reduce((a, d) => a + BigInt(d.amountRaw), 0n);
      if (total !== BigInt(req.amountRaw)) {
        throw new MhError("MH_017", "Destination shares must sum to amountRaw exactly", 400);
      }
    }
    const state: SimState = {
      id: existing.reduce((m, s) => Math.max(m, s.id), 1000) + 1,
      externalId: req.externalId ?? null,
      tokenMint: req.tokenMint,
      tokenSymbol: req.tokenSymbol ?? null,
      amountRaw: req.amountRaw,
      amountTokens: req.amountTokens,
      sourceOwner: req.sourceOwner,
      recipientWallet: req.recipientWallet ?? null,
      destinations: req.destinations?.map((d) => [d.wallet, d.amountRaw]) ?? null,
      hops,
      arrivalSeconds: req.arrivalSeconds ?? 300,
      createdAt: Date.now(),
      keeperFunded: false,
      startedAt: null,
    };
    await this.store.put(state);
    return viewTransfer(state);
  }

  async prepare(id: number): Promise<PrepareResponse> {
    const s = await this.find((x) => x.id === id);
    const transfer = viewTransfer(s);
    if (transfer.status === "completed") {
      throw new MhError("MH_035", "Transfer not in a state that allows this operation", 409);
    }
    const started = s.startedAt !== null;
    return {
      transfer,
      preparedTxs: {
        keeperFundingTx: s.keeperFunded || started ? null : "DEMO",
        routeInitTxs: started ? [] : [{ base64: "DEMO" }],
        orchestratorInitTx: started ? null : "DEMO",
        sessionInitTxs: started ? [] : ["DEMO", "DEMO"],
        dispersionInitTxs: started || !s.destinations ? [] : ["DEMO"],
        recentBlockhash: "demo",
        lastValidBlockHeight: 0,
        resume: { nothingToDo: started, routeAlreadyDeployed: started },
      },
    };
  }

  async confirmBroadcast(id: number, body: ConfirmBroadcastRequest): Promise<Transfer> {
    const s = await this.find((x) => x.id === id);
    if (body.keeperFundingSignature) s.keeperFunded = true;
    if (body.routeInitSignatures.length > 0) {
      if (!s.keeperFunded) throw new MhError("MH_039", "keeperFundingSignature is required", 400);
      if (s.destinations && !body.dispersionInitSignatures?.length) {
        throw new MhError("MH_041", "Destinations not yet bound on chain", 409);
      }
      if (s.startedAt === null) s.startedAt = Date.now();
    }
    await this.store.put(s);
    return viewTransfer(s);
  }

  async getTransfer(id: number): Promise<Transfer> {
    return viewTransfer(await this.find((x) => x.id === id));
  }

  async getByExternalId(externalId: string): Promise<Transfer> {
    return viewTransfer(await this.find((x) => x.externalId === externalId));
  }

  async listTransfers(q: { limit?: number; offset?: number }): Promise<TransferList> {
    const all = (await this.store.all()).sort((a, b) => b.id - a.id).map((s) => viewTransfer(s));
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    return { items: all.slice(offset, offset + limit), pagination: { total: all.length, limit, offset } };
  }

  async usage(): Promise<UsageSummary> {
    const all = (await this.store.all()).map((s) => viewTransfer(s));
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
