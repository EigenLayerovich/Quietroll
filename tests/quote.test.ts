import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { MockMhApi } from "@/lib/mh/mock";
import { quoteRoute } from "@/lib/quote";
import { SOL_MINT } from "@/lib/tokens";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const addr = () => Keypair.generate().publicKey.toBase58();

describe("quoteRoute", () => {
  it("grosses up so recipients receive the sheet amount (SPL)", async () => {
    const amounts = [4_200_000_000n, 3_850_500_000n, 1_333_333n];
    const net = amounts.reduce((a, b) => a + b, 0n);
    const q = await quoteRoute(new MockMhApi(), { tokenMint: USDC, tokenDecimals: 6, hops: 3, arrivalSeconds: 300, feeMode: "on_top", amounts });
    expect(q.exact).toBe(true);
    // One spare base unit per recipient is delivered so rounding favours them.
    expect(BigInt(q.deliveredRaw)).toBe(net + 3n);
    expect(BigInt(q.amountRaw)).toBe(BigInt(q.deliveredRaw) + BigInt(q.percentFeeRaw));
    const shares = q.shares.map(BigInt);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(BigInt(q.amountRaw));
    // The protocol pays floor(share * delivered / total): never below the sheet.
    shares.forEach((sh, i) => {
      const paid = (sh * BigInt(q.deliveredRaw)) / BigInt(q.amountRaw);
      expect(paid).toBeGreaterThanOrEqual(amounts[i]);
      expect(paid - amounts[i]).toBeLessThanOrEqual(4n);
    });
  });

  it("grosses up SOL, where the per-hop charge is inside the amount", async () => {
    const amounts = [2_000_000_000n, 500_000_000n];
    const q = await quoteRoute(new MockMhApi(), { tokenMint: SOL_MINT, tokenDecimals: 9, hops: 5, arrivalSeconds: 300, feeMode: "on_top", amounts });
    expect(q.exact).toBe(true);
    expect(BigInt(q.deliveredRaw)).toBe(2_500_000_002n);
    expect(BigInt(q.amountRaw)).toBe(2_500_000_002n + BigInt(q.percentFeeRaw) + BigInt(q.flatFeeLamports));
  });

  it("delivers a single recipient exactly the sheet amount", async () => {
    const q = await quoteRoute(new MockMhApi(), { tokenMint: USDC, tokenDecimals: 6, hops: 3, arrivalSeconds: 300, feeMode: "on_top", amounts: [2_500_000_000n] });
    expect(q.deliveredRaw).toBe("2500000000");
    expect(q.exact).toBe(true);
  });

  it("deducts fees from recipients when asked", async () => {
    const q = await quoteRoute(new MockMhApi(), { tokenMint: USDC, tokenDecimals: 6, hops: 3, arrivalSeconds: 300, feeMode: "deducted", amounts: [1_000_000_000n] });
    expect(q.amountRaw).toBe("1000000000");
    expect(BigInt(q.deliveredRaw)).toBeLessThan(1_000_000_000n);
    expect(q.exact).toBe(false);
  });
});

describe("demo simulator lifecycle", () => {
  it("is idempotent on externalId and enforces broadcast order", async () => {
    const api = new MockMhApi();
    const body = {
      tokenMint: USDC, tokenDecimals: 6, amountRaw: "3000000", amountTokens: "3", sourceOwner: addr(), hops: 3, arrivalSeconds: 300,
      externalId: "qr-abc123def4-000",
      destinations: [{ wallet: addr(), amountRaw: "1000000" }, { wallet: addr(), amountRaw: "2000000" }],
    };
    const t = await api.createTransfer(body);
    expect((await api.createTransfer(body)).id).toBe(t.id);
    expect(t.destinations!.map((d) => BigInt(d.amountRaw)).reduce((a, b) => a + b, 0n)).toBe(BigInt(t.recipientReceivesRaw!));

    await expect(api.confirmBroadcast(t.id, { routeInitSignatures: ["x"] })).rejects.toMatchObject({ code: "MH_039" });
    await api.confirmBroadcast(t.id, { routeInitSignatures: [], keeperFundingSignature: "k" });
    await expect(api.confirmBroadcast(t.id, { routeInitSignatures: ["x"] })).rejects.toMatchObject({ code: "MH_041" });
    const started = await api.confirmBroadcast(t.id, { routeInitSignatures: ["x"], dispersionInitSignatures: ["d"] });
    expect(started.status).toBe("processing");
    expect((await api.prepare(t.id)).preparedTxs.resume?.nothingToDo).toBe(true);
  });

  it("rejects shares that do not sum to the total", async () => {
    await expect(
      new MockMhApi().createTransfer({
        tokenMint: USDC, tokenDecimals: 6, amountRaw: "3000000", amountTokens: "3", sourceOwner: addr(),
        destinations: [{ wallet: addr(), amountRaw: "1" }, { wallet: addr(), amountRaw: "2" }],
      }),
    ).rejects.toMatchObject({ code: "MH_017" });
  });
});
