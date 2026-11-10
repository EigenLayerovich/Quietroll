// Pure payout-batch logic: parsing a recipient sheet, exact decimal maths,
// fee gross-up and splitting into Multi-Send routes. No I/O, so it is unit
// tested directly (tests/batch.test.ts).

import { PublicKey } from "@solana/web3.js";

/** MultiHopper pays at most 20 destinations from one route. */
export const MAX_DESTINATIONS = 20;
/** Demo mode keeps its simulated routes in cookies, which caps how many fit. */
export const DEMO_MAX_ROUTES = 6;
/** A SOL payout creates the destination account, so it must clear rent. */
export const SOL_RENT_EXEMPT_LAMPORTS = 890_880n;

export interface Row {
  /** 1-based line number in the pasted sheet, for error messages. */
  line: number;
  wallet: string;
  /** Amount in base units the recipient should end up with. */
  amountRaw: bigint;
  /** Free-text label. Kept in the browser only; never sent to any server. */
  label: string;
}

export interface RowError {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: Row[];
  errors: RowError[];
}

export function isValidWallet(address: string): boolean {
  try {
    return new PublicKey(address).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Parse a human decimal ("1,250.50") into base units without floats. */
export function toRaw(amount: string, decimals: number): bigint | null {
  const s = amount.trim().replace(/,/g, "").replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null;
  const padded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function fromRaw(raw: bigint | string, decimals: number): string {
  const v = BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

function splitLine(line: string): string[] {
  // Accept comma, tab or semicolon separated sheets, with optional quotes.
  const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Parse `wallet, amount[, label]` lines. A header row is skipped. Every
 * problem is reported with its line number rather than failing on the first.
 */
export function parseSheet(text: string, decimals: number, isSol = false): ParseResult {
  const rows: Row[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1;
    if (!rawLine.trim()) return;
    const cells = splitLine(rawLine);
    const [wallet = "", amount = "", ...rest] = cells;
    if (rows.length === 0 && errors.length === 0 && !isValidWallet(wallet) && toRaw(amount, decimals) === null) {
      return; // header row
    }
    if (!isValidWallet(wallet)) {
      errors.push({ line, message: `"${wallet.slice(0, 16)}" is not a valid Solana address` });
      return;
    }
    const amountRaw = toRaw(amount, decimals);
    if (amountRaw === null) {
      errors.push({ line, message: `"${amount}" is not a valid amount (max ${decimals} decimals)` });
      return;
    }
    if (amountRaw <= 0n) {
      errors.push({ line, message: "Amount must be greater than zero" });
      return;
    }
    if (isSol && amountRaw < SOL_RENT_EXEMPT_LAMPORTS) {
      errors.push({ line, message: "SOL payouts must be at least 0.00089088 SOL (rent-exempt minimum)" });
      return;
    }
    const dup = seen.get(wallet);
    if (dup !== undefined) {
      errors.push({ line, message: `Duplicate of line ${dup} - combine them into one row` });
      return;
    }
    seen.set(wallet, line);
    rows.push({ line, wallet, amountRaw, label: rest.join(", ") });
  });

  return { rows, errors };
}

export function chunkRows<T>(rows: T[], size = MAX_DESTINATIONS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export const sumRaw = (rows: { amountRaw: bigint }[]) => rows.reduce((a, r) => a + r.amountRaw, 0n);

/**
 * First guess at the gross amount to send so that `net` arrives after the
 * percent fee. The fee is charged on the delivered (hop) amount:
 * gross = net + floor(net * bps / 10000). The server refines this against
 * /estimate, which also accounts for SOL's in-amount flat fees.
 */
export function grossUp(net: bigint, percentFeeBps: number): bigint {
  return net + (net * BigInt(percentFeeBps)) / 10_000n;
}

/**
 * Split `total` across destinations in proportion to `weights`, summing to
 * `total` exactly (MultiHopper rejects shares that do not). Leftover base
 * units from rounding go to the largest remainders, so no share is off by
 * more than one base unit.
 */
export function proportionalShares(weights: bigint[], total: bigint): bigint[] {
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum <= 0n) throw new Error("weights must sum to a positive amount");
  const shares = weights.map((w) => (w * total) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (w * total) % weightSum }));
  let leftover = total - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of remainders) {
    if (leftover <= 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }
  return shares;
}

/**
 * Shares for "recipients receive the sheet amount". The protocol pays each
 * destination floor(share * delivered / total), so a plain proportional split
 * can leave someone one base unit short. Rounding every share up instead
 * guarantees nobody receives less than `amounts[i]`; `delivered` must exceed
 * the sheet total by at least one base unit per recipient to leave room for
 * that (see `roundingHeadroom`). Any slack goes to the first recipient.
 */
export function atLeastShares(amounts: bigint[], total: bigint, delivered: bigint): bigint[] {
  const shares = amounts.map((a) => (a * total + delivered - 1n) / delivered);
  const slack = total - shares.reduce((a, b) => a + b, 0n);
  if (slack < 0n) throw new Error("delivered amount leaves no room for rounding");
  shares[0] += slack;
  return shares;
}

/** Extra base units to deliver so `atLeastShares` always has room. */
export const roundingHeadroom = (recipients: number) => (recipients > 1 ? BigInt(recipients) : 0n);

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newBatchId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
  return s;
}

/**
 * Deterministic per-route external id. Re-submitting the same route returns
 * the existing transfer instead of creating a second one, so a retry after a
 * crash or a double click can never pay anyone twice.
 */
export function externalIdFor(batchId: string, chunkIndex: number): string {
  return `qr-${batchId}-${String(chunkIndex).padStart(3, "0")}`;
}

export function parseExternalId(externalId: string | null | undefined): { batchId: string; chunk: number } | null {
  const m = /^qr-([a-z0-9]{10})-(\d{3})$/.exec(externalId ?? "");
  return m ? { batchId: m[1], chunk: Number(m[2]) } : null;
}

export function shortAddr(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}
