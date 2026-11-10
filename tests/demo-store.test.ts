import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {}, delete: () => {} }) }));

import { MockMhApi, viewTransfer, type SimState } from "@/lib/mh/mock";
import { decodeSim, encodeSim } from "@/lib/mh/mock-cookie-store";

const addr = () => Keypair.generate().publicKey.toBase58();

function fullRoute(): SimState {
  return {
    id: 1001,
    externalId: "qr-abc123def4-000",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenSymbol: "USDC",
    amountRaw: "100500000000",
    amountTokens: "100500",
    sourceOwner: addr(),
    recipientWallet: null,
    destinations: Array.from({ length: 20 }, () => [addr(), "5025000000"] as [string, string]),
    hops: 10,
    arrivalSeconds: 2_592_000,
    createdAt: 1_800_000_000_000,
    keeperFunded: true,
    startedAt: 1_800_000_001_000,
  };
}

describe("cookie-backed demo store", () => {
  it("round-trips a full 20-recipient route within one cookie", () => {
    const s = fullRoute();
    const encoded = encodeSim(s);
    // A cookie may be at most 4096 bytes including its name and attributes.
    expect(encoded.length).toBeLessThan(2500);
    expect(decodeSim(encoded)).toEqual(s);
  });

  it("ignores cookies it cannot read", () => {
    expect(decodeSim("not-a-cookie")).toBeNull();
    expect(decodeSim("")).toBeNull();
  });
});

describe("stateless lifecycle", () => {
  it("derives every stage from the stored state and the clock alone", () => {
    const s = fullRoute();
    const t0 = s.startedAt!;
    expect(viewTransfer({ ...s, startedAt: null }).status).toBe("quote");
    expect(viewTransfer(s, t0 + 100).status).toBe("processing");

    const mid = viewTransfer(s, t0 + 5 * 2500 + 10);
    expect(mid.status).toBe("active");
    expect(mid.progress).toEqual({ hopsCompleted: 5, hopsTotal: 10 });

    const paying = viewTransfer(s, t0 + 10 * 2500 + 3 * 700 + 10);
    expect(paying.status).toBe("active");
    expect(paying.destinations!.filter((d) => d.status === "paid")).toHaveLength(3);

    const done = viewTransfer(s, t0 + 10 * 2500 + 20 * 700 + 10);
    expect(done.status).toBe("completed");
    expect(done.destinations!.every((d) => d.status === "paid" && d.payoutSignature)).toBe(true);
    // Rebuilding later gives the same answer: nothing depends on memory.
    expect(viewTransfer(s, t0 + 9e9)).toEqual(done);
    const sum = done.destinations!.reduce((a, d) => a + BigInt(d.amountRaw), 0n);
    expect(sum).toBe(BigInt(done.recipientReceivesRaw!));
  });

  it("two server instances sharing one store see the same transfers", async () => {
    const store = new (await import("@/lib/mh/mock")).MemorySimStore();
    const a = new MockMhApi(store);
    const b = new MockMhApi(store);
    const t = await a.createTransfer({
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenDecimals: 6, amountRaw: "1000000", amountTokens: "1",
      sourceOwner: addr(), recipientWallet: addr(), externalId: "qr-abc123def4-001",
    });
    await b.confirmBroadcast(t.id, { routeInitSignatures: [], keeperFundingSignature: "k" });
    expect((await a.confirmBroadcast(t.id, { routeInitSignatures: ["r"] })).status).toBe("processing");
    expect((await b.getByExternalId("qr-abc123def4-001")).id).toBe(t.id);
  });
});
