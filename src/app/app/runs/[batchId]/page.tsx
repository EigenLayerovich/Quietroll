"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/Providers";
import { fromRaw, shortAddr } from "@/lib/batch";
import { deployTransfer } from "@/lib/deploy";
import { ApiError, call } from "@/lib/http";
import type { Transfer } from "@/lib/mh/types";
import { getRun, saveRun, setDraft, type StoredRun } from "@/lib/store";
import { explorerTx, type Token } from "@/lib/tokens";

const fmt = (raw: bigint | string, decimals: number) => {
  const [w, f = ""] = fromRaw(raw, decimals).split(".");
  const frac = f.slice(0, 6).replace(/0+$/, "");
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
};

type Tone = "" | "good" | "warn" | "bad";
function statusOf(t: Transfer | null | undefined): { label: string; tone: Tone; sendable: boolean; live: boolean } {
  if (!t) return { label: "Not sent", tone: "", sendable: true, live: false };
  switch (t.status) {
    case "quote":
    case "awaiting_signature":
      return { label: "Awaiting your approval", tone: "warn", sendable: true, live: false };
    case "processing":
      // MultiHopper reports `processing` once the keeper is funded, even if
      // the rest of the route was never broadcast. While the phase is still
      // pre-execution, keep Send available so an interrupted deploy can be
      // resumed; resuming a route that is in fact complete sends nothing.
      return t.phase && t.phase !== "executing" && t.phase !== "settled"
        ? { label: "Deploying", tone: "warn", sendable: true, live: true }
        : { label: "Screening", tone: "warn", sendable: false, live: true };
    case "active":
      return { label: "Routing", tone: "warn", sendable: false, live: true };
    case "completed":
      return { label: "Paid", tone: "good", sendable: false, live: false };
    case "refunded":
      return { label: "Refunded", tone: "bad", sendable: false, live: false };
    case "expired":
      return { label: "Quote expired", tone: "bad", sendable: false, live: false };
    default:
      return { label: "Failed", tone: "bad", sendable: false, live: false };
  }
}

export default function RunPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const app = useApp();
  const router = useRouter();

  const [run, setRun] = useState<StoredRun | null>(null);
  const [transfers, setTransfers] = useState<(Transfer | null)[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState<{ route: number; step: string } | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const sendingRef = useRef(false);

  useEffect(() => setRun(getRun(batchId)), [batchId]);

  const refresh = useCallback(async () => {
    const count = getRun(batchId)?.routes.length ?? 0;
    try {
      const r = await call<{ transfers: (Transfer | null)[] }>(`/api/batches/${batchId}${count ? `?count=${count}` : ""}`);
      setTransfers(r.transfers);
    } catch {
      // Keep the last known state; the next poll retries.
    } finally {
      setLoaded(true);
    }
  }, [batchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const anyLive = transfers.some((t) => statusOf(t).live);
  useEffect(() => {
    if (!anyLive || sending) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [anyLive, sending, refresh]);

  const token: Token | undefined = useMemo(() => {
    const mint = run?.tokenMint ?? transfers.find(Boolean)?.tokenMint;
    return app.config?.tokens.find((t) => t.mint === mint);
  }, [run, transfers, app.config]);

  const routeCount = Math.max(run?.routes.length ?? 0, transfers.length);
  const routes = Array.from({ length: routeCount }, (_, i) => ({
    index: i,
    local: run?.routes[i],
    transfer: transfers[i] ?? null,
  }));

  async function sendRoute(i: number): Promise<boolean> {
    const local = run?.routes[i];
    if (!local || !run) return false;
    setErrors((e) => ({ ...e, [i]: "" }));
    try {
      setSending({ route: i, step: "Creating route…" });
      const t = await call<Transfer>("/api/transfers", {
        tokenMint: run.tokenMint,
        externalId: local.externalId,
        hops: run.hops,
        arrivalSeconds: run.arrivalSeconds,
        amountRaw: local.quote.amountRaw,
        destinations: local.rows.map((r, k) => ({ wallet: r.wallet, amountRaw: local.quote.shares[k] })),
      });
      await deployTransfer(t.id, {
        mock: app.config?.mock ?? false,
        signAll: app.signAll,
        onStep: (step, detail) =>
          setSending({
            route: i,
            step:
              step === "preparing"
                ? "Preparing transactions…"
                : step === "signing"
                  ? `Approve in your wallet (${detail})`
                  : step === "broadcasting"
                    ? `${detail}`
                    : "Confirming with MultiHopper…",
          }),
      });
      return true;
    } catch (e) {
      setErrors((prev) => ({ ...prev, [i]: explain(e) }));
      return false;
    } finally {
      await refresh();
    }
  }

  async function sendAll() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      for (const r of routes) {
        if (!r.local || r.local.superseded || !statusOf(r.transfer).sendable) continue;
        // Stop at the first failure so the user can read it before signing more.
        if (!(await sendRoute(r.index))) break;
      }
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  }

  /** Move routes whose quote went stale into a fresh run for re-pricing. */
  function requote() {
    if (!run || !token) return;
    const stale = routes.filter(
      (r) => r.local && !r.local.superseded && (r.transfer?.status === "expired" || isStale(errors[r.index])),
    );
    const lines = stale.flatMap((r) =>
      r.local!.rows.map((row) => `${row.wallet},${fromRaw(row.amountRaw, token.decimals)},${row.label}`),
    );
    saveRun({
      ...run,
      routes: run.routes.map((rt, i) => (stale.some((s) => s.index === i) ? { ...rt, superseded: true } : rt)),
    });
    setDraft(lines.join("\n"));
    router.push("/app");
  }

  function exportCsv() {
    if (!token) return;
    const head = ["run", "route", "transfer_id", "support_id", "recipient", "name", "amount", "token", "status", "paid_at", "payout_signature"];
    const lines = [head.join(",")];
    for (const r of routes) {
      const t = r.transfer;
      const dests =
        t?.destinations ??
        (t?.recipientWallet
          ? [{ wallet: t.recipientWallet, amountRaw: t.recipientReceivesRaw ?? "0", status: t.status === "completed" ? "paid" : "pending", payoutSignature: t.signatures?.hops?.at(-1) ?? null, paidAt: t.completedAt }]
          : (r.local?.rows ?? []).map((x) => ({ wallet: x.wallet, amountRaw: x.amountRaw, status: "not_sent", payoutSignature: null, paidAt: null })));
      for (const d of dests) {
        const label = r.local?.rows.find((x) => x.wallet === d.wallet)?.label ?? "";
        lines.push(
          [batchId, r.index + 1, t?.id ?? "", t?.supportBundleId ?? "", d.wallet, `"${label.replace(/"/g, '""')}"`, fromRaw(d.amountRaw, token.decimals), token.symbol, d.status ?? "", d.paidAt ?? "", d.payoutSignature ?? ""].join(","),
        );
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `quietroll-${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!loaded || !app.config) return <p className="muted">Loading run…</p>;
  if (routeCount === 0 || !token) {
    return (
      <section className="card">
        <h1>Run not found</h1>
        <p className="muted">
          No payout run with this id exists for the signed-in wallet. Runs that were never sent only exist in the
          browser that created them.
        </p>
        <Link className="btn" href="/app">
          Start a new payout
        </Link>
      </section>
    );
  }

  const sendable = routes.filter((r) => r.local && !r.local.superseded && statusOf(r.transfer).sendable);
  const paidRoutes = routes.filter((r) => r.transfer?.status === "completed").length;
  const recipients = routes.reduce((a, r) => a + (r.local?.rows.length ?? r.transfer?.destinationCount ?? 1), 0);
  const paidRecipients = routes.reduce((a, r) => {
    const t = r.transfer;
    if (!t) return a;
    if (t.destinations) return a + t.destinations.filter((d) => d.status === "paid").length;
    return a + (t.status === "completed" ? 1 : 0);
  }, 0);
  const delivered = routes.reduce(
    (a, r) => a + BigInt(r.transfer?.recipientReceivesRaw ?? r.local?.quote.deliveredRaw ?? "0"),
    0n,
  );
  const hasStale = routes.some(
    (r) => r.local && !r.local.superseded && (r.transfer?.status === "expired" || isStale(errors[r.index])),
  );
  const c = app.config.cluster;

  return (
    <>
      <div className="spread">
        <div>
          <h1>{run?.name ?? "Payout run"}</h1>
          <p className="muted small">
            Run <span className="mono">{batchId}</span>
            {run && ` · created ${new Date(run.createdAt).toLocaleString()}`}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportCsv}>
            Export receipts (CSV)
          </button>
        </div>
      </div>

      <section className="card">
        <dl className="figures">
          <div className="figure">
            <dt>Recipients paid</dt>
            <dd>
              {paidRecipients} <small>of {recipients}</small>
            </dd>
          </div>
          <div className="figure">
            <dt>Total delivered</dt>
            <dd>
              {fmt(delivered, token.decimals)} <small>{token.symbol}</small>
            </dd>
          </div>
          <div className="figure">
            <dt>Routes complete</dt>
            <dd>
              {paidRoutes} <small>of {routeCount}</small>
            </dd>
          </div>
        </dl>

        {sendable.length > 0 && (
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-lg" onClick={sendAll} disabled={sending !== null}>
              {sending
                ? `Route ${sending.route + 1}: ${sending.step}`
                : sendable.length === routeCount
                  ? `Sign and send ${routeCount === 1 ? "payout" : `${routeCount} routes`}`
                  : `Send ${sendable.length} remaining route${sendable.length === 1 ? "" : "s"}`}
            </button>
            {!sending && (
              <span className="muted small">
                One wallet approval per route. You can close this page after a route starts routing.
              </span>
            )}
          </div>
        )}
        {hasStale && !sending && (
          <div className="notice notice-warn">
            Some routes were priced too long ago to send safely.{" "}
            <button className="btn" onClick={requote}>
              Re-quote those routes
            </button>
          </div>
        )}
        {sendable.length === 0 && paidRoutes === routeCount && (
          <div className="notice notice-good">Everyone on this run has been paid.</div>
        )}
      </section>

      {routes.map((r) => {
        const s = statusOf(r.transfer);
        const t = r.transfer;
        const hopsDone = t?.progress?.hopsCompleted ?? 0;
        const hopsTotal = t?.progress?.hopsTotal ?? run?.hops ?? 0;
        const dests = t?.destinations ?? null;
        const paid = dests?.filter((d) => d.status === "paid").length ?? (t?.status === "completed" ? 1 : 0);
        const total = dests?.length ?? r.local?.rows.length ?? 1;
        const pct = t?.status === "completed" ? 100 : hopsTotal ? Math.round(((hopsDone + paid / total) / (hopsTotal + 1)) * 100) : 0;
        const rows =
          dests?.map((d) => ({ wallet: d.wallet, amountRaw: d.amountRaw, paid: d.status === "paid", sig: d.payoutSignature })) ??
          (t?.recipientWallet
            ? [{ wallet: t.recipientWallet, amountRaw: t.recipientReceivesRaw ?? "0", paid: t.status === "completed", sig: t.signatures?.hops?.at(-1) ?? null }]
            : (r.local?.rows ?? []).map((x) => ({ wallet: x.wallet, amountRaw: x.amountRaw, paid: false, sig: null })));

        return (
          <section className="card" key={r.index}>
            <div className="route-head">
              <h2 style={{ margin: 0 }}>Route {r.index + 1}</h2>
              <span className={`badge ${s.tone ? `badge-${s.tone}` : ""}`}>
                {r.local?.superseded ? "Moved to a new run" : s.label}
              </span>
              <div className="grow">
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Route ${r.index + 1} progress`}>
                  <i style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span className="muted small">
                {t ? `${hopsDone}/${hopsTotal} hops · ${paid}/${total} paid` : `${total} recipient${total === 1 ? "" : "s"}`}
              </span>
            </div>

            {t?.status === "refunded" && (
              <div className="notice notice-bad">
                Compliance screening stopped this route and the principal was returned to your wallet. The screening
                fee is not refunded. MultiHopper does not disclose which address was flagged.
              </div>
            )}
            {errors[r.index] && (
              <div className="notice notice-bad" role="alert">
                {errors[r.index]}
              </div>
            )}

            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Wallet</th>
                    <th className="num">Receives</th>
                    <th>Status</th>
                    <th>Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.wallet}>
                      <td>{r.local?.rows.find((x) => x.wallet === d.wallet)?.label || <span className="muted">—</span>}</td>
                      <td className="mono" title={d.wallet}>
                        {shortAddr(d.wallet, 5)}
                      </td>
                      <td className="num">
                        {fmt(d.amountRaw, token.decimals)} {token.symbol}
                      </td>
                      <td>{d.paid ? <span className="badge badge-good">Paid</span> : <span className="muted">{t ? "Pending" : "Not sent"}</span>}</td>
                      <td>
                        {d.sig ? (
                          app.config!.mock ? (
                            <span className="mono muted" title="Simulated in demo mode">
                              {shortAddr(d.sig, 5)}
                            </span>
                          ) : (
                            <a className="mono" href={explorerTx(c, d.sig)} target="_blank" rel="noreferrer">
                              {shortAddr(d.sig, 5)}
                            </a>
                          )
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t && (
              <p className="muted small" style={{ margin: "10px 0 0" }}>
                Transfer #{t.id}
                {t.supportBundleId ? ` · support ref ${t.supportBundleId}` : ""}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

const isStale = (msg: string | undefined) => !!msg && msg.startsWith("The price moved");

function explain(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "MH_040":
        return "The price moved across a fee tier since this route was quoted. Re-quote it to continue; nothing was sent.";
      case "MH_034":
        return "The price moved: this quote expired before it was sent. Re-quote it to continue.";
      case "MH_017":
        return `${e.message} Try "Recipients per route: 1" for this token.`;
      case "MH_091":
        return "MultiHopper is not ready to accept this route (if this is a new integration, its rewards wallet may not be funded yet). Try again shortly.";
      case "UNAUTHENTICATED":
        return "Your session expired. Sign in again; this run is saved.";
      default:
        return e.message;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "You declined the approval in your wallet. Nothing was sent.";
  if (/insufficient/i.test(msg)) return "The wallet does not hold enough SOL or tokens for this route. Top it up and send again.";
  return msg;
}
