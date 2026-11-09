"use client";

// Payout runs are kept in this browser only. Recipient labels (names, memos)
// never leave it: the server and MultiHopper only ever see wallets and amounts.

import type { FeeMode, RouteQuote } from "./quote";

export interface StoredRow {
  wallet: string;
  amountRaw: string;
  label: string;
}

export interface StoredRoute {
  externalId: string;
  rows: StoredRow[];
  quote: RouteQuote;
  /** Set when the route was moved into a newer run after a stale quote. */
  superseded?: boolean;
}

export interface StoredRun {
  batchId: string;
  createdAt: string;
  wallet: string;
  name: string;
  tokenMint: string;
  hops: number;
  arrivalSeconds: number;
  feeMode: FeeMode;
  routes: StoredRoute[];
}

const KEY = "quietroll:runs:v1";
const DRAFT = "quietroll:draft:v1";

function readAll(): StoredRun[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredRun[];
  } catch {
    return [];
  }
}

export function listRuns(wallet: string): StoredRun[] {
  return readAll()
    .filter((r) => r.wallet === wallet)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRun(batchId: string): StoredRun | null {
  return readAll().find((r) => r.batchId === batchId) ?? null;
}

export function saveRun(run: StoredRun) {
  const all = readAll().filter((r) => r.batchId !== run.batchId);
  all.push(run);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the run still works for this page view.
  }
}

/** Sheet text handed from a run page back to the composer for a re-quote. */
export function setDraft(text: string) {
  try {
    sessionStorage.setItem(DRAFT, text);
  } catch {}
}

export function takeDraft(): string | null {
  try {
    const t = sessionStorage.getItem(DRAFT);
    if (t) sessionStorage.removeItem(DRAFT);
    return t;
  } catch {
    return null;
  }
}
