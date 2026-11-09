import Link from "next/link";
import { Logo } from "@/components/AppShell";

export default function Landing() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Logo />
          <div className="topbar-right">
            <Link className="btn btn-primary" href="/app">
              Open app
            </Link>
          </div>
        </div>
      </header>
      <main className="page">
        <section className="hero">
          <h1>Pay your whole team without publishing your payroll.</h1>
          <p className="lede">
            Paste a sheet of wallets and amounts. Quietroll routes the payout through MultiHopper so each person is
            paid separately, on schedule, with sanctions screening built in. You sign in your own wallet; we never
            hold funds.
          </p>
          <div className="row">
            <Link className="btn btn-primary btn-lg" href="/app">
              Start a payout
            </Link>
            <a className="btn btn-lg" href="#how">
              How it works
            </a>
          </div>
        </section>

        <section id="how" className="steps">
          <div className="card">
            <div className="n">01</div>
            <h3>Paste your sheet</h3>
            <p className="muted">
              Wallet, amount, optional name. Up to hundreds of recipients in USDC or SOL. Names stay in your browser.
            </p>
          </div>
          <div className="card">
            <div className="n">02</div>
            <h3>See the exact cost</h3>
            <p className="muted">
              Fees are quoted from the on-chain schedule before you sign. Recipients receive the amount on the sheet.
            </p>
          </div>
          <div className="card">
            <div className="n">03</div>
            <h3>Approve once per route</h3>
            <p className="muted">
              Each route pays up to 20 people. Your wallet signs; the protocol&apos;s keepers deliver on the schedule
              you chose.
            </p>
          </div>
          <div className="card">
            <div className="n">04</div>
            <h3>Export receipts</h3>
            <p className="muted">
              Every payout has a transaction signature. Download a CSV for your books when the run completes.
            </p>
          </div>
        </section>

        <section className="two">
          <div className="card">
            <h2>Why teams use it</h2>
            <ul className="checks">
              <li>
                A normal bulk send puts every salary in one public transaction. Routed payouts are separate transfers
                that do not appear in the route&apos;s published hop list.
              </li>
              <li>Every sender and recipient is screened with TRM Labs data before funds move.</li>
              <li>Schedule delivery from five minutes to thirty days ahead.</li>
              <li>Retries are safe: a route can never be created or funded twice.</li>
              <li>Non-custodial. Funds sit in a program vault, not with us, until they are delivered.</li>
            </ul>
          </div>
          <div className="card">
            <h2>Pricing</h2>
            <p>
              <strong>0.5%</strong> of the amount paid out, plus Solana network costs (a per-hop charge and a
              screening fee of about 0.002 SOL per wallet). No subscription, no minimum.
            </p>
            <p className="muted small">
              The full cost of every route is shown before you sign, and most of the SOL you post as account rent is
              returned when the route closes.
            </p>
            <h3 style={{ marginTop: 18 }}>What it is not</h3>
            <p className="muted small">
              Routing reduces how easily payments are linked. It is not anonymity: payouts are ordinary on-chain
              transfers that a determined analyst can observe, and screening means it cannot be used to move
              sanctioned funds.
            </p>
          </div>
        </section>

        <footer className="foot">
          Built on{" "}
          <a href="https://multihopper.com" rel="noreferrer" target="_blank">
            MultiHopper
          </a>{" "}
          programmable routing. Quietroll is an independent integration.
        </footer>
      </main>
    </>
  );
}
