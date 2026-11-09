# Superteam Earn submission draft

Fill every `[bracket]` with real figures before submitting. Do not submit numbers you cannot back with the
evidence export: the organisers reconcile entries against their own records.

## Product

**Name:** Quietroll

**Live URL:** [https://…]

**Demo video:** [link, under 3 minutes]

**Repository:** [link, or "private: review access granted to …"]

**One line:** Non-custodial batch payouts on Solana. Pay a whole sheet of contributors, sellers or winners
through MultiHopper Multi-Send, with screening, scheduling and receipts.

## The user problem

Teams that pay people in stablecoins on Solana use a bulk sender. That puts every recipient and every
amount in one transaction, so each contributor can open the transaction that paid them and read what
everyone else earns, and so can anyone watching the treasury. The alternative is sending payments one by
one by hand, which does not scale past a handful of people and leaves no clean record.

Finance leads also need to show that payees were screened, and they need receipts they can reconcile.

## How Quietroll uses MultiHopper

- **Multi-Send as the core primitive.** A sheet is split into routes of up to 20 `destinations`. Each route
  is one MultiHopper transfer, so recipients are paid separately after the last hop and are not written
  into the route's hop list.
- **Exact pricing from `/transfers/estimate`.** The app searches the estimate endpoint for the gross amount
  whose post-fee delivery equals the sheet total, so recipients receive the amount on the sheet and the
  sender sees the full cost (percent fee, per-hop charge, screening fee, SOL reserve) before signing.
- **Full deploy lifecycle.** `/prepare` → one wallet approval → broadcast in protocol order
  (keeper funding, route init, orchestrator, sessions, dispersion) → `/confirm-broadcast`, with the keeper
  funding recorded immediately and resumption through `/prepare` after any interruption.
- **Idempotency.** Deterministic `externalId`s make every retry safe: a route cannot be created or funded
  twice.
- **Scheduling** through `arrivalSeconds`, from five minutes to thirty days.
- **Compliance surfaced to the user.** Screening fees are shown up front and a `refunded` route is explained
  as a screening stop.
- **Per-recipient tracking and receipts** from `GET /transfers`, including each payout signature.

**Integration identifier:** [as confirmed in the builder chat — no secrets]

**Technical documentation:** `README.md` in the repository (architecture, security model, go-live steps).

## Security

- Non-custodial: all transactions are signed in the user's wallet.
- The MultiHopper API key and RPC key are server-side only.
- Wallet sign-in (signed message, HMAC session cookie). `sourceOwner` is always the session wallet, and
  every transfer read or action checks ownership server-side.
- Recipient names never leave the sender's browser.
- 23 automated tests cover the payment maths, sign-in and transaction handling.

## Traction (window: 21 Oct to 30 Nov 2026)

From `npm run evidence` (attach the CSV and JSON):

| Metric | Value |
| - | - |
| Qualifying volume | [$…] |
| Completed transfers (routes) | […] |
| Recipients paid | […] |
| Unique paying organisations (sender wallets) | […] |
| Organisations that ran more than one payout | […] |
| Largest single run | [$…] |

**Customers and use cases:** [who used it and for what: e.g. "X DAO, monthly contributor payroll, 18
people". Send anything sensitive privately to the review team, as the listing asks.]

**Growth:** [first payout date, week-over-week volume, what is booked for December]

## Contact

[name, Telegram, email]

---

## Demo video outline (about 2 minutes)

1. **The problem (15s).** Show a bulk-send transaction on an explorer with every amount visible.
2. **Paste a sheet (20s).** Real mainnet, small real amounts. Show line-level validation by breaking one row.
3. **Quote (20s).** Point at "recipients receive", "you send", and the fee lines.
4. **Sign and send (30s).** One wallet approval; show the broadcast steps.
5. **Tracking (20s).** Hops completing, recipients turning to Paid, a payout signature opened on Solscan.
6. **Receipts and traction (15s).** Export the CSV; close on the real volume figure.
