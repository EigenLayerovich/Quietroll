#!/usr/bin/env node
// Exports the transaction evidence the Build & Route challenge asks for:
// transfer ids, mainnet signatures, timestamps, amounts and volume totals,
// plus the fee summary MultiHopper reports for this integration.
//
//   MH_API_KEY=mh_live_... MH_API_BASE=https://multihopper.com \
//     node scripts/evidence.mjs 2026-10-21 2026-11-30
//
// Reads only. Writes evidence-<from>_<to>.csv and .json next to package.json.

import { writeFileSync } from "node:fs";

const [from = "2026-10-21", to = "2026-11-30"] = process.argv.slice(2);
const key = process.env.MH_API_KEY;
const base = (process.env.MH_API_BASE ?? "https://multihopper.com").replace(/\/+$/, "");
if (!key) {
  console.error("Set MH_API_KEY (and MH_API_BASE for devnet).");
  process.exit(1);
}
const fromDate = new Date(`${from}T00:00:00.000Z`).toISOString();
const toDate = new Date(`${to}T23:59:59.999Z`).toISOString();

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { "x-api-key": key } });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(`${path}: ${body?.error?.code ?? res.status} ${body?.error?.message ?? ""}`);
    return body;
  }
}

const q = `fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`;
const usage = await get(`/usage?${q}`);

const transfers = [];
for (let offset = 0; ; offset += 100) {
  const page = await get(`/transfers?${q}&limit=100&offset=${offset}`);
  transfers.push(...page.items);
  if (page.items.length === 0 || offset + 100 >= page.pagination.total) break;
}

const completed = transfers.filter((t) => t.status === "completed");
const dec = (raw, d) => {
  const s = BigInt(raw).toString().padStart(d + 1, "0");
  return `${s.slice(0, -d) || "0"}.${s.slice(-d)}`.replace(/\.?0+$/, "");
};
const decimalsOf = (t) => (t.amountTokens && t.amountTokens !== "0" ? Math.round(Math.log10(Number(t.amountRaw) / Number(t.amountTokens))) : 6);

const head = ["transfer_id", "external_id", "support_id", "created_at", "completed_at", "token", "token_mint", "amount", "delivered", "percent_fee", "recipients", "source_wallet", "route_init_signatures", "payout_signatures"];
const rows = completed.map((t) => {
  const d = decimalsOf(t);
  const payouts = t.destinations?.map((x) => x.payoutSignature).filter(Boolean) ?? t.signatures?.hops?.slice(-1) ?? [];
  return [
    t.id, t.externalId ?? "", t.supportBundleId ?? "", t.createdAt, t.completedAt ?? "", t.tokenSymbol ?? "", t.tokenMint,
    dec(t.amountRaw, d), dec(t.recipientReceivesRaw ?? "0", d), dec(t.percentFeeRaw ?? "0", d),
    t.destinationCount ?? 1, t.sourceOwner, (t.signatures?.routeInit ?? []).join(" "), payouts.join(" "),
  ].join(",");
});

// Qualifying volume per the rules: collected percent fees / 0.0025, i.e. the
// integrator's half of the 0.5% fee divided by 0.25%. Reported per token;
// convert non-USD tokens at the price MultiHopper used.
const byToken = {};
for (const t of completed) {
  const k = t.tokenSymbol ?? t.tokenMint;
  const d = decimalsOf(t);
  byToken[k] ??= { decimals: d, transfers: 0, feeRaw: 0n, senders: new Set() };
  byToken[k].transfers += 1;
  byToken[k].feeRaw += BigInt(t.percentFeeRaw ?? "0");
  byToken[k].senders.add(t.sourceOwner);
}
const summary = {
  window: { from: fromDate, to: toDate },
  environment: base,
  isTestMode: usage.isTestMode,
  usage,
  completedTransfers: completed.length,
  uniqueSenders: new Set(completed.map((t) => t.sourceOwner)).size,
  repeatSenders: Object.entries(completed.reduce((m, t) => ((m[t.sourceOwner] = (m[t.sourceOwner] ?? 0) + 1), m), {})).filter(([, n]) => n > 1).length,
  qualifyingVolumeByToken: Object.fromEntries(
    Object.entries(byToken).map(([k, v]) => [k, { transfers: v.transfers, uniqueSenders: v.senders.size, percentFees: dec(v.feeRaw, v.decimals), qualifyingVolume: dec(v.feeRaw * 200n, v.decimals) }]),
  ),
};

const stem = `evidence-${from}_${to}`;
writeFileSync(`${stem}.csv`, [head.join(","), ...rows].join("\n") + "\n");
writeFileSync(`${stem}.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary.qualifyingVolumeByToken, null, 2));
console.log(`\n${completed.length} completed transfers from ${summary.uniqueSenders} wallets -> ${stem}.csv, ${stem}.json`);
if (usage.isTestMode) console.log("NOTE: test-mode data. Only production (mh_live_) volume counts for the challenge.");
