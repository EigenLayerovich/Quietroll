"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { shortAddr } from "@/lib/batch";
import { useApp } from "./Providers";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Quietroll home">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="3" fill="currentColor" />
        <circle cx="12" cy="12" r="2" fill="currentColor" opacity=".55" />
        <circle cx="19" cy="6" r="2.2" fill="currentColor" />
        <circle cx="19" cy="12" r="2.2" fill="currentColor" />
        <circle cx="19" cy="18" r="2.2" fill="currentColor" />
      </svg>
      <span>Quietroll</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const app = useApp();
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Logo />
          <nav className="topnav">
            <Link href="/app">New payout</Link>
            <Link href="/app/runs">Runs</Link>
          </nav>
          <div className="topbar-right">
            {app.config?.mock && <span className="badge badge-warn">Demo mode</span>}
            {app.config && !app.config.mock && (
              <span className="badge">{app.config.cluster === "mainnet" ? "Mainnet" : "Devnet"}</span>
            )}
            {app.wallet ? (
              <button className="btn btn-ghost" onClick={app.signOut} title="Sign out">
                <span className="mono">{shortAddr(app.wallet)}</span> · Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>
      {app.config?.mock && (
        <div className="demo-strip">
          Demo mode: no MultiHopper API key is configured, so payouts are simulated and no funds move.
        </div>
      )}
      <main className="page">{app.wallet ? children : <SignInCard />}</main>
    </>
  );
}

function SignInCard() {
  const app = useApp();
  const needsSignature = app.connected && !app.wallet;
  return (
    <section className="card signin">
      <h1>Sign in with your wallet</h1>
      <p className="muted">
        Quietroll is non-custodial. You approve every payout in your own wallet; we never hold your funds or keys.
        Signing in is a free message signature, not a transaction.
      </p>
      <div className="row">
        {!app.connected && (
          <button className="btn btn-primary" onClick={app.connect}>
            Connect wallet
          </button>
        )}
        {needsSignature && (
          <button className="btn btn-primary" onClick={app.signIn} disabled={app.busy}>
            {app.busy ? "Waiting for signature…" : `Sign in as ${shortAddr(app.connected!)}`}
          </button>
        )}
        {app.config?.mock && (
          <button className="btn" onClick={app.startDemo} disabled={app.busy}>
            Try the demo without a wallet
          </button>
        )}
      </div>
      {app.error && <p className="error">{app.error}</p>}
    </section>
  );
}
