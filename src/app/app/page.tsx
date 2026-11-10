"use client";

import { Keypair } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/Providers";
import {
  DEMO_MAX_ROUTES,
  MAX_DESTINATIONS,
  chunkRows,
  externalIdFor,
  fromRaw,
  newBatchId,
  parseSheet,
  shortAddr,
  sumRaw,
  type Row,
} from "@/lib/batch";
import { ApiError, call, rpc } from "@/lib/http";
import type { FeeMode, RouteQuote } from "@/lib/quote";
import { saveRun, takeDraft, type StoredRun } from "@/lib/store";
import { SOL_MINT } from "@/lib/tokens";

const DELIVERY = [
  { label: "As soon as possible (about 5 minutes)", seconds: 300 },
  { label: "Within 1 hour", seconds: 3600 },
  { label: "Within 6 hours", seconds: 21_600 },
  { label: "In 24 hours", seconds: 86_400 },
  { label: "In 7 days", seconds: 604_800 },
];

const fmt = (raw: bigint | string, decimals: number, max = 6) => {
  const [w, f = ""] = fromRaw(raw, decimals).split(".");
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};
const sol = (lamports: number | bigint) => fmt(BigInt(lamports), 9, 4);

interface Quoted {
  rows: Row[];
  quote: RouteQuote;
}

// When the sender covers fees, show the sheet total: every recipient gets at
// least that (the route delivers up to one spare base unit each for rounding).
const shown = (q: Quoted) => (q.quote.exact ? sumRaw(q.rows) : BigInt(q.quote.deliveredRaw));

export default function Composer() {
  const app = useApp();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const tokens = app.config?.tokens ?? [];
  const [mint, setMint] = useState("");
  const token = tokens.find((t) => t.mint === mint) ?? tokens[0];
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("on_top");
  const [arrival, setArrival] = useState(300);
  const [hops, setHops] = useState(3);
  const [perRoute, setPerRoute] = useState(MAX_DESTINATIONS);

  const [quoted, setQuoted] = useState<Quoted[] | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    const draft = takeDraft();
    if (draft) setText(draft);
  }, []);

  const parsed = useMemo(
    () => (token ? parseSheet(text, token.decimals, token.mint === SOL_MINT) : { rows: [], errors: [] }),
    [text, token],
  );
  const routes = useMemo(() => chunkRows(parsed.rows, perRoute), [parsed.rows, perRoute]);

  // Any change to the inputs invalidates the quote on screen.
  useEffect(() => {
    setQuoted(null);
    setError(null);
  }, [text, mint, feeMode, arrival, hops, perRoute]);

  if (!token) return <p className="muted">Loading…</p>;
  const overDemoLimit = !!app.config?.mock && routes.length > DEMO_MAX_ROUTES;
  const isSol = token.mint === SOL_MINT;

  function loadSample() {
    const amounts = ["4200", "3850.50", "3100", "2750", "2400", "1980.25", "1500", "1250", "900", "640"];
    const names = ["Design lead", "Backend", "Frontend", "Community", "Data", "QA", "Support", "Writer", "Mod", "Intern"];
    const scale = isSol ? 0.01 : 1;
    setText(
      "wallet,amount,name\n" +
        amounts
          .map((a, i) => `${Keypair.generate().publicKey.toBase58()},${(Number(a) * scale).toFixed(2)},${names[i]}`)
          .join("\n"),
    );
    if (!name) setName("November contributors");
  }

  async function onFile(f: File | undefined) {
    if (f) setText(await f.text());
  }

  async function getQuote() {
    setError(null);
    setQuoted(null);
    try {
      const out: Quoted[] = [];
      for (let i = 0; i < routes.length; i++) {
        setQuoting(`Pricing route ${i + 1} of ${routes.length}…`);
        const quote = await call<RouteQuote>("/api/quote", {
          tokenMint: token.mint,
          hops,
          arrivalSeconds: arrival,
          feeMode,
          amounts: routes[i].map((r) => r.amountRaw.toString()),
        });
        out.push({ rows: routes[i], quote });
      }
      setQuoted(out);
      if (!app.config?.mock && app.wallet) {
        rpc<{ value: number }>("getBalance", [app.wallet])
          .then((r) => setBalance(BigInt(r.value)))
          .catch(() => setBalance(null));
      }
    } catch (e) {
      setError(explain(e));
    } finally {
      setQuoting(null);
    }
  }

  function createRun() {
    if (!quoted || !app.wallet) return;
    const batchId = newBatchId();
    const run: StoredRun = {
      batchId,
      createdAt: new Date().toISOString(),
      wallet: app.wallet,
      name: name.trim() || `Payout ${new Date().toLocaleDateString()}`,
      tokenMint: token.mint,
      hops,
      arrivalSeconds: arrival,
      feeMode,
      routes: quoted.map((q, i) => ({
        externalId: externalIdFor(batchId, i),
        quote: q.quote,
        rows: q.rows.map((r) => ({ wallet: r.wallet, amountRaw: r.amountRaw.toString(), label: r.label })),
      })),
    };
    saveRun(run);
    router.push(`/app/runs/${batchId}`);
  }

  const totals = quoted && {
    send: quoted.reduce((a, q) => a + BigInt(q.quote.amountRaw), 0n),
    delivered: quoted.reduce((a, q) => a + shown(q), 0n),
    percentFee: quoted.reduce((a, q) => a + BigInt(q.quote.percentFeeRaw), 0n),
    flat: quoted.reduce((a, q) => a + q.quote.flatFeeLamports, 0),
    screening: quoted.reduce((a, q) => a + q.quote.screeningFeeLamports, 0),
    // Routes are sent one at a time, so the wallet needs the largest single
    // reserve rather than the sum (rent comes back as each route closes).
    peakSol: quoted.reduce((a, q) => Math.max(a, q.quote.requiredSolLamports), 0),
  };
  const solNeeded = totals ? BigInt(totals.peakSol) + (isSol ? totals.send : 0n) : 0n;
  const short = balance !== null && totals !== null && balance < solNeeded;

  return (
    <>
      <div className="spread">
        <h1>New payout</h1>
        <span className="muted small">Signed in as {shortAddr(app.wallet ?? "")}</span>
      </div>

      <section className="card">
        <div className="spread">
          <h2>1. Recipients</h2>
          <div className="row">
            <button className="btn btn-ghost" onClick={loadSample}>
              Load a sample
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        </div>
        <label className="field">
          <span>
            One recipient per line: <span className="mono">wallet, amount, name (optional)</span>. Names stay in this
            browser.
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={"wallet,amount,name\n7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u,2500,Ana\n3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4,1800.50,Sam"}
            aria-label="Recipient sheet"
          />
        </label>

        {parsed.errors.length > 0 && (
          <div className="notice notice-bad" role="alert">
            {parsed.errors.length} line{parsed.errors.length === 1 ? "" : "s"} need fixing before you can continue:
            <ul>
              {parsed.errors.slice(0, 8).map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.message}
                </li>
              ))}
              {parsed.errors.length > 8 && <li>…and {parsed.errors.length - 8} more</li>}
            </ul>
          </div>
        )}

        {parsed.rows.length > 0 && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {parsed.rows.length} recipient{parsed.rows.length === 1 ? "" : "s"} · {fmt(sumRaw(parsed.rows), token.decimals)}{" "}
            {token.symbol} · {routes.length} route{routes.length === 1 ? "" : "s"}
          </p>
        )}
      </section>

      <section className="card">
        <h2>2. Options</h2>
        <div className="grid">
          <label className="field">
            <span>Run name (private)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="November contributors" />
          </label>
          <label className="field">
            <span>Token</span>
            <select value={token.mint} onChange={(e) => setMint(e.target.value)}>
              {tokens.map((t) => (
                <option key={t.mint} value={t.mint}>
                  {t.symbol} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Delivery</span>
            <select value={arrival} onChange={(e) => setArrival(Number(e.target.value))}>
              {DELIVERY.map((d) => (
                <option key={d.seconds} value={d.seconds}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Who pays the fees</span>
            <select value={feeMode} onChange={(e) => setFeeMode(e.target.value as FeeMode)}>
              <option value="on_top">I do: recipients get the sheet amount</option>
              <option value="deducted">Deduct from each recipient</option>
            </select>
          </label>
          <label className="field">
            <span>Hops per route</span>
            <select value={hops} onChange={(e) => setHops(Number(e.target.value))}>
              <option value={3}>3 · lowest cost</option>
              <option value={5}>5</option>
              <option value={7}>7 · more separation</option>
              <option value={10}>10 · maximum</option>
            </select>
          </label>
          <label className="field">
            <span>Recipients per route</span>
            <select value={perRoute} onChange={(e) => setPerRoute(Number(e.target.value))}>
              <option value={20}>Up to 20 · cheapest</option>
              <option value={10}>Up to 10</option>
              <option value={5}>Up to 5</option>
              <option value={1}>1 · a separate route each</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            onClick={getQuote}
            disabled={parsed.rows.length === 0 || parsed.errors.length > 0 || quoting !== null || overDemoLimit}
          >
            {quoting ?? "Get exact quote"}
          </button>
          {parsed.rows.length === 0 && <span className="muted small">Add at least one recipient to get a quote.</span>}
          {overDemoLimit && (
            <span className="muted small">
              Demo mode handles up to {DEMO_MAX_ROUTES} routes per run. Remove some recipients or raise "Recipients per
              route".
            </span>
          )}
        </div>
        {error && (
          <div className="notice notice-bad" role="alert">
            {error}
          </div>
        )}
      </section>

      {quoted && totals && (
        <section className="card">
          <h2>3. Review</h2>
          <dl className="figures">
            <div className="figure">
              <dt>Recipients receive</dt>
              <dd>
                {fmt(totals.delivered, token.decimals)} <small>{token.symbol}</small>
              </dd>
            </div>
            <div className="figure">
              <dt>You send</dt>
              <dd>
                {fmt(totals.send, token.decimals)} <small>{token.symbol}</small>
              </dd>
            </div>
            <div className="figure">
              <dt>Routing fee (0.5%)</dt>
              <dd>
                {fmt(totals.percentFee, token.decimals)} <small>{token.symbol}</small>
              </dd>
            </div>
            <div className="figure">
              <dt>Network and screening</dt>
              <dd>
                {sol(totals.flat + totals.screening)} <small>SOL</small>
              </dd>
            </div>
          </dl>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="num">Recipients</th>
                  <th className="num">Delivered</th>
                  <th className="num">You send</th>
                  <th className="num">SOL to hold</th>
                  <th className="num">Returned after</th>
                </tr>
              </thead>
              <tbody>
                {quoted.map((q, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="num">{q.rows.length}</td>
                    <td className="num">
                      {fmt(shown(q), token.decimals)} {token.symbol}
                    </td>
                    <td className="num">
                      {fmt(q.quote.amountRaw, token.decimals)} {token.symbol}
                    </td>
                    <td className="num">{sol(q.quote.requiredSolLamports)}</td>
                    <td className="num">{sol(q.quote.refundableSolLamports)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>
            Your wallet needs {fmt(totals.send, token.decimals)} {token.symbol}
            {isSol ? " plus " : " and "}
            about {sol(totals.peakSol)} SOL in reserve while a route deploys. You approve each route once in your
            wallet.
          </p>

          {feeMode === "on_top" && quoted.some((q) => !q.quote.exact) && (
            <div className="notice notice-warn">
              One or more routes sit on a fee-tier boundary, so recipients on those routes will receive slightly less
              than the sheet amount. Changing an amount on that route by a few cents avoids this.
            </div>
          )}
          {short && (
            <div className="notice notice-warn">
              This wallet holds {sol(balance!)} SOL but needs about {sol(solNeeded)} SOL. Top it up before sending.
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-lg" onClick={createRun}>
              Continue to send
            </button>
            <span className="muted small">Nothing is sent until you approve it in your wallet.</span>
          </div>
        </section>
      )}
    </>
  );
}

function explain(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "MH_010":
        return "MultiHopper does not support this token on this network yet. Try USDC or SOL.";
      case "MH_014":
        return "That delivery time is too short for this many hops. Choose a later delivery or fewer hops.";
      case "MH_016":
      case "MH_012":
        return "An amount is too small to cover its fees. Increase it or remove that recipient.";
      case "MH_017":
        return `${e.message} If this token cannot be paid to several recipients per route here, set "Recipients per route" to 1.`;
      case "MH_004":
        return "Too many requests right now. Wait a minute and try again.";
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
