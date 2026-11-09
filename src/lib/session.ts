// Wallet sign-in. The user proves control of a wallet by signing a one-time
// message; the server then issues an HMAC-signed, httpOnly session cookie.
// Every API route uses the session wallet as `sourceOwner`, so one customer
// can never read or act on another customer's payouts. Stateless: no DB.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "qr_session";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

const g = globalThis as unknown as { __qrSecret?: string };

function secret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (process.env.MH_API_KEY?.trim()) {
    // Never run against the real API with a guessable or per-process secret.
    throw new Error("SESSION_SECRET (32+ chars) must be set when MH_API_KEY is configured");
  }
  return (g.__qrSecret ??= randomBytes(32).toString("hex"));
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signInMessage(wallet: string, issuedAt: number, nonce: string, host: string): string {
  return [
    `${host} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to Quietroll. This does not move funds or approve any transaction.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
  ].join("\n");
}

export function issueChallenge(wallet: string, host: string) {
  const issuedAt = Date.now();
  const nonce = mac(`nonce|${wallet}|${issuedAt}|${host}`);
  return { issuedAt, nonce, message: signInMessage(wallet, issuedAt, nonce, host) };
}

export function verifyChallenge(input: {
  wallet: string;
  issuedAt: number;
  nonce: string;
  signature: string; // base64
  host: string;
}): boolean {
  const { wallet, issuedAt, nonce, signature, host } = input;
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > NONCE_TTL_MS || issuedAt > Date.now() + 60_000) {
    return false;
  }
  if (!safeEqual(nonce, mac(`nonce|${wallet}|${issuedAt}|${host}`))) return false;
  try {
    const message = new TextEncoder().encode(signInMessage(wallet, issuedAt, nonce, host));
    const sig = Buffer.from(signature, "base64");
    return sig.length === 64 && nacl.sign.detached.verify(message, sig, new PublicKey(wallet).toBytes());
  } catch {
    return false;
  }
}

export function createSessionToken(wallet: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${wallet}.${exp}`;
  return `${payload}.${mac(`session|${payload}`)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [wallet, exp, sig] = token.split(".");
  if (!wallet || !exp || !sig) return null;
  if (!safeEqual(sig, mac(`session|${wallet}.${exp}`))) return null;
  if (Number(exp) < Date.now()) return null;
  return wallet;
}

export const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000;

/** The signed-in wallet for the current request, or null. */
export async function sessionWallet(): Promise<string | null> {
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}
