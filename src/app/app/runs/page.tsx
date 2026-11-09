"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/Providers";
import { fromRaw, parseExternalId } from "@/lib/batch";
import { call } from "@/lib/http";
import type { Transfer } from "@/lib/mh/types";
import { listRuns, type StoredRun } from "@/lib/store";

interface RunSummary {
  batchId: string;
  name: string;
  createdAt: string;
  tokenMint: string;
  routes: number;
  sent: number;
  completed: number;
  deliveredRaw: bigint;
}

export default function Runs() {
  const app = useApp();
  const [remote, setRemote] = useState<Transfer[] | null>(null);
  const [local, setLocal] = useState<StoredRun[]>([]);

  useEffect(() => {
    if (!app.wallet) return;
    setLocal(listRuns(app.wallet));
    call<{ items: Transfer[] }>("/api/transfers")
      .then((r) => setRemote(r.items))
      .catch(() => setRemote([]));
  }, [app.wallet]);

  // Merge what this browser remembers (names, unsent runs) with what
  // MultiHopper has on record (runs sent from any device with this wallet).
  const runs = useMemo(() => {
    const map = new Map<string, RunSummary>();
    for (const r of local) {
      map.set(r.batchId, {
        batchId: r.batchId,
        name: r.name,
        createdAt: r.createdAt,
        tokenMint: r.tokenMint,
        routes: r.routes.length,
        sent: 0,
        completed: 0,
        deliveredRaw: 0n,
      });
    }
    for (const t of remote ?? []) {
      const id = parseExternalId(t.externalId);
      if (!id) continue;
      const s =
        map.get(id.batchId) ??
        ({ batchId: id.batchId, name: "Payout run", createdAt: t.createdAt, tokenMint: t.tokenMint, routes: 0, sent: 0, completed: 0, deliveredRaw: 0n } satisfies RunSummary);
      s.routes = Math.max(s.routes, id.chunk + 1);
      if (!["quote", "awaiting_signature", "expired"].includes(t.status)) s.sent += 1;
      if (t.status === "completed") {
        s.completed += 1;
        s.deliveredRaw += BigInt(t.recipientReceivesRaw ?? "0");
      }
      map.set(id.batchId, s);
    }
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [local, remote]);

  return (
    <>
      <div className="spread">
        <h1>Runs</h1>
        <Link className="btn btn-primary" href="/app">
          New payout
        </Link>
      </div>
      <section className="card">
        {remote === null ? (
          <p className="muted">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="muted">No payout runs yet. Your runs will appear here once you create one.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Created</th>
                  <th className="num">Routes paid</th>
                  <th className="num">Delivered</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const token = app.config?.tokens.find((t) => t.mint === r.tokenMint);
                  const done = r.completed === r.routes;
                  return (
                    <tr key={r.batchId}>
                      <td>
                        <Link href={`/app/runs/${r.batchId}`}>{r.name}</Link>{" "}
                        <span className="mono muted small">{r.batchId}</span>
                      </td>
                      <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="num">
                        {r.completed}/{r.routes}
                      </td>
                      <td className="num">
                        {token ? `${fromRaw(r.deliveredRaw, token.decimals)} ${token.symbol}` : "—"}
                      </td>
                      <td>
                        <span className={`badge ${done ? "badge-good" : r.sent > 0 ? "badge-warn" : ""}`}>
                          {done ? "Paid" : r.sent > 0 ? "In progress" : "Not sent"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
