import { atLeastShares, grossUp, proportionalShares, roundingHeadroom } from "./batch";
import type { FeeEstimate, MhApi } from "./mh";

export type FeeMode = "on_top" | "deducted";

export interface RouteQuote {
  /** Total the sender's wallet spends in the token, fees included. */
  amountRaw: string;
  /** Each destination's share of amountRaw; sums to it exactly. */
  shares: string[];
  /** What all destinations receive together after fees. */
  deliveredRaw: string;
  percentFeeRaw: string;
  percentFeeBps: number;
  flatFeeLamports: number;
  /** SOL the wallet must hold up front (rent, screening, network fees). */
  requiredSolLamports: number;
  refundableSolLamports: number;
  screeningFeeLamports: number;
  /** True when every recipient receives at least the amount on the sheet. */
  exact: boolean;
}

/**
 * Price one route. In "on_top" mode the sender covers fees so every recipient
 * receives the sheet amount: we search for the gross `amountRaw` whose
 * post-fee hop amount equals the sheet total, using MultiHopper's own
 * /estimate as the oracle so the figure matches what the chain will charge
 * (including SOL's in-amount per-hop charge and tier boundaries).
 */
export async function quoteRoute(
  api: MhApi,
  p: {
    tokenMint: string;
    tokenDecimals: number;
    hops: number;
    arrivalSeconds: number;
    feeMode: FeeMode;
    amounts: bigint[];
  },
): Promise<RouteQuote> {
  const net = p.amounts.reduce((a, b) => a + b, 0n);
  const ask = (amountRaw: bigint) =>
    api.estimate({
      tokenMint: p.tokenMint,
      amountRaw: amountRaw.toString(),
      tokenDecimals: p.tokenDecimals,
      hops: p.hops,
      arrivalSeconds: p.arrivalSeconds,
      // Single-recipient routes use recipientWallet, not the payout engine.
      destinationCount: p.amounts.length > 1 ? p.amounts.length : undefined,
    });

  // With several recipients, deliver one spare base unit each so rounding
  // can only ever favour the recipient (0.000001 USDC apiece at most).
  const target = net + roundingHeadroom(p.amounts.length);
  let amountRaw = net;
  let est: FeeEstimate;

  if (p.feeMode === "deducted") {
    est = await ask(amountRaw);
  } else {
    amountRaw = grossUp(target, 50);
    est = await ask(amountRaw);
    for (let i = 0; i < 5 && BigInt(est.hopAmountRaw) !== target; i++) {
      // The shortfall is itself subject to the percent fee, so gross it up
      // too; always move at least one base unit so the search cannot stall.
      const gap = target - BigInt(est.hopAmountRaw);
      const step = gap + (gap * BigInt(est.percentFeeBps)) / 10_000n;
      amountRaw += step !== 0n ? step : gap > 0n ? 1n : -1n;
      est = await ask(amountRaw);
    }
  }

  const delivered = BigInt(est.hopAmountRaw);
  const exact = p.feeMode === "on_top" && delivered >= target;
  const b = est.sol.breakdown ?? {};
  return {
    amountRaw: amountRaw.toString(),
    shares: (exact ? atLeastShares(p.amounts, amountRaw, delivered) : proportionalShares(p.amounts, amountRaw)).map(String),
    deliveredRaw: delivered.toString(),
    percentFeeRaw: est.percentFeeRaw,
    percentFeeBps: est.percentFeeBps,
    flatFeeLamports: est.totalFlatFeeLamports,
    requiredSolLamports: est.sol.requiredSolUpFrontLamports,
    refundableSolLamports: est.sol.refundableLamports ?? 0,
    screeningFeeLamports: b.screeningFeeLamports ?? 0,
    exact,
  };
}
