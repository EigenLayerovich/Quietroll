import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createSessionToken, issueChallenge, readSessionToken, verifyChallenge } from "@/lib/session";

const sign = (kp: Keypair, message: string) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)).toString("base64");

describe("wallet sign-in", () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const host = "quietroll.example";

  it("accepts a signature from the wallet's own key", () => {
    const ch = issueChallenge(wallet, host);
    expect(verifyChallenge({ wallet, host, issuedAt: ch.issuedAt, nonce: ch.nonce, signature: sign(kp, ch.message) })).toBe(true);
  });

  it("rejects another key, another host, a forged nonce and a stale challenge", () => {
    const ch = issueChallenge(wallet, host);
    const good = { wallet, host, issuedAt: ch.issuedAt, nonce: ch.nonce, signature: sign(kp, ch.message) };
    expect(verifyChallenge({ ...good, signature: sign(Keypair.generate(), ch.message) })).toBe(false);
    expect(verifyChallenge({ ...good, host: "evil.example" })).toBe(false);
    expect(verifyChallenge({ ...good, nonce: "forged" })).toBe(false);
    expect(verifyChallenge({ ...good, wallet: Keypair.generate().publicKey.toBase58() })).toBe(false);
    expect(verifyChallenge({ ...good, issuedAt: ch.issuedAt - 6 * 60_000 })).toBe(false);
  });

  it("issues tamper-proof session tokens", () => {
    const token = createSessionToken(wallet);
    expect(readSessionToken(token)).toBe(wallet);
    const other = Keypair.generate().publicKey.toBase58();
    expect(readSessionToken(token.replace(wallet, other))).toBeNull();
    expect(readSessionToken("garbage")).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });
});
