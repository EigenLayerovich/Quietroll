import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  atLeastShares,
  chunkRows,
  externalIdFor,
  fromRaw,
  grossUp,
  parseExternalId,
  parseSheet,
  proportionalShares,
  toRaw,
} from "@/lib/batch";

const addr = () => Keypair.generate().publicKey.toBase58();

describe("decimal maths", () => {
  it("converts without float error", () => {
    expect(toRaw("0.1", 6)).toBe(100_000n);
    expect(toRaw("1,250.50", 6)).toBe(1_250_500_000n);
    expect(toRaw("$40", 6)).toBe(40_000_000n);
    expect(toRaw("123456789.123456789", 9)).toBe(123_456_789_123_456_789n);
  });
  it("rejects malformed or over-precise amounts", () => {
    for (const bad of ["", "abc", "-5", "1.2.3", "1e3", "0.0000001"]) expect(toRaw(bad, 6)).toBeNull();
    expect(toRaw("1.2300000", 6)).toBe(1_230_000n); // trailing zeros are fine
  });
  it("round-trips", () => {
    expect(fromRaw(1_250_500_000n, 6)).toBe("1250.5");
    expect(fromRaw("1", 9)).toBe("0.000000001");
    expect(fromRaw(0n, 6)).toBe("0");
  });
});

describe("parseSheet", () => {
  it("skips a header and reads labels", () => {
    const a = addr();
    const r = parseSheet(`wallet,amount,name\n${a},100.5,Ana Diaz\n`, 6);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ line: 2, wallet: a, amountRaw: 100_500_000n, label: "Ana Diaz" }]);
  });
  it("accepts tabs and semicolons", () => {
    const a = addr();
    const b = addr();
    expect(parseSheet(`${a}\t5\n${b};7;Sam`, 6).rows.map((x) => x.amountRaw)).toEqual([5_000_000n, 7_000_000n]);
  });
  it("reports every bad line with its number", () => {
    const a = addr();
    const r = parseSheet(`${a},10\nnot-a-wallet,10\n${addr()},zero\n${a},3\n${addr()},0`, 6);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[2].message).toMatch(/Duplicate of line 1/);
  });
  it("enforces the SOL rent-exempt minimum", () => {
    expect(parseSheet(`${addr()},0.0005`, 9, true).errors).toHaveLength(1);
    expect(parseSheet(`${addr()},0.001`, 9, true).errors).toHaveLength(0);
  });
});

describe("routes", () => {
  it("chunks into at most 20", () => {
    const sizes = chunkRows(Array.from({ length: 45 }, (_, i) => i)).map((c) => c.length);
    expect(sizes).toEqual([20, 20, 5]);
  });
  it("shares always sum exactly to the total", () => {
    for (let n = 0; n < 200; n++) {
      const weights = Array.from({ length: 1 + (n % 20) }, (_, i) => BigInt(1 + ((n * 7919 + i * 104729) % 9_999_999)));
      const net = weights.reduce((a, b) => a + b, 0n);
      const total = grossUp(net, 50);
      const shares = proportionalShares(weights, total);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
      // Each recipient's delivered amount is within one base unit of the sheet.
      shares.forEach((s, i) => {
        const delivered = (s * net) / total;
        expect(weights[i] - delivered).toBeGreaterThanOrEqual(0n);
        expect(weights[i] - delivered).toBeLessThanOrEqual(1n);
      });
    }
  });
  it("atLeastShares never pays anyone below the sheet amount", () => {
    for (let n = 0; n < 300; n++) {
      const amounts = Array.from({ length: 2 + (n % 19) }, (_, i) => BigInt(1 + ((n * 15485863 + i * 32452843) % 5_000_000_000)));
      const delivered = amounts.reduce((a, b) => a + b, 0n) + BigInt(amounts.length);
      const total = grossUp(delivered, 50) + BigInt(n % 3) * 2_000_000n; // SPL, and SOL with flat fees inside
      const shares = atLeastShares(amounts, total, delivered);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
      shares.forEach((s, i) => expect((s * delivered) / total).toBeGreaterThanOrEqual(amounts[i]));
    }
  });
  it("external ids are deterministic and parse back", () => {
    expect(externalIdFor("abc123def4", 7)).toBe("qr-abc123def4-007");
    expect(parseExternalId("qr-abc123def4-007")).toEqual({ batchId: "abc123def4", chunk: 7 });
    expect(parseExternalId("order_1")).toBeNull();
  });
});
