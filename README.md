# Quietroll

Discreet batch payouts on Solana, built on [MultiHopper](https://dev-docs.multihopper.com) Multi-Send.

Paste a sheet of `wallet, amount, name`. Quietroll splits it into routes of up to 20 recipients, quotes the
exact cost from MultiHopper's on-chain fee schedule, has the sender approve each route once in their own wallet,
then tracks every recipient until paid and exports receipts.

Entry for the [MultiHopper Build & Route Challenge](https://superteam.fun/earn/listing/multihopper-build-and-route-challenge-up-to-dollar50000-revenue-share-1).

## Status

| | |
| - | - |
| Unit tests (`npm test`) | 27 passing: sheet parsing, decimal maths, fee gross-up, share splitting, sign-in, transaction ordering and signature preservation, stateless demo store |
| Browser test, demo mode | Passing: sign in, quote, send two routes, all recipients paid, CSV export; also with the server restarted mid-payout |
| Against the live MultiHopper API | **Not yet run.** No API key was available when this was built. Do the devnet checklist below before any mainnet use. |

## Run it

```bash
npm install
```

```bash
npm run dev
```

With no `MH_API_KEY` the app runs in **demo mode**: an in-memory simulator stands in for MultiHopper, a
throwaway wallet can sign in, and no chain is touched. The UI says so on every page.

To use the real API, copy `.env.example` to `.env.local` and fill it in:

| Variable | Purpose |
| - | - |
| `MH_API_KEY` | `mh_test_...` (devnet) or `mh_live_...` (mainnet). Server-side only. |
| `MH_API_BASE` | `https://devnet.multihopper.com` or `https://multihopper.com` |
| `SOLANA_RPC_URL` | RPC used to broadcast. Use a paid endpoint on mainnet. Server-side only. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` or `mainnet`: selects token mints and explorer links |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32`). Required once a key is set, and always on Vercel. |

## How the integration works

```
browser                         Quietroll server                MultiHopper API        Solana
  | sign-in (message signature)       |                               |                  |
  |---------------------------------->| session cookie                |                  |
  | POST /api/quote (per route)       | POST /transfers/estimate      |                  |
  |---------------------------------->|------------------------------>|                  |
  | POST /api/transfers               | POST /transfers  (externalId) |                  |
  | POST /api/transfers/:id/prepare   | POST /transfers/:id/prepare   |                  |
  |<------ unsigned bundle -----------|                               |                  |
  | wallet signs all (one approval)   |                               |                  |
  | POST /api/rpc sendTransaction ------------------------------------------------------>|
  |   keeperFunding -> routeInit -> orchestratorInit -> sessionInit -> dispersionInit    |
  | POST /api/transfers/:id/confirm   | POST .../confirm-broadcast    |                  |
  | GET  /api/batches/:id (poll)      | GET /transfers/by-external/…  |                  |
```

- **Non-custodial.** Transactions are signed in the user's wallet. The server never sees a private key.
- **API key stays server-side.** The browser talks only to this app's routes (`src/app/api`).
- **Ownership is enforced server-side.** `sourceOwner` is always the signed-in wallet, and every read or
  action on a transfer first checks that wallet created it (`src/lib/api.ts`).
- **No double payments.** Each route has a deterministic `externalId` (`qr-<run>-<nnn>`), so a retry returns
  the existing transfer. Deploys resume through `/prepare`, which only returns what is not yet on chain.
- **Recipients get the sheet amount.** In the default fee mode the server searches `/estimate` for the gross
  amount whose post-fee delivery covers the sheet, then rounds shares up so nobody is paid less
  (`src/lib/quote.ts`, `src/lib/batch.ts`).
- **No database.** Runs are rebuilt from MultiHopper by external id. Recipient names live only in the
  sender's browser (`src/lib/store.ts`).
- **Stateless server.** Nothing is held in server memory, so it runs on serverless hosts. In demo mode the
  simulated routes live in the visitor's cookies (`src/lib/mh/mock-cookie-store.ts`), which limits a demo
  run to 6 routes.

Key files: `src/lib/mh/client.ts` (API client), `src/lib/deploy.ts` (sign and broadcast),
`src/lib/quote.ts` (pricing), `src/lib/session.ts` (wallet sign-in), `src/lib/mh/mock.ts` (demo simulator).

## Go-live checklist

Devnet first:

1. Create a key at <https://devnet.multihopper.com/developer/dashboard> and set the env vars for devnet.
2. Fund a wallet with devnet SOL. Send SOL to **one** recipient ("Recipients per route: 1"), then to three.
3. Confirm each of these against the real API, because they could only be simulated so far:
   - the wallet shows one approval per route and the route reaches `Paid`;
   - Multi-Send works for the token you plan to sell (if SPL payouts return `MH_017`, use 1 recipient per
     route for that token);
   - the shortest delivery time is accepted for each hop count (`MH_014` means it is too short);
   - closing the tab mid-deploy and pressing Send again resumes instead of paying twice.

Then mainnet:

4. Create an `mh_live_` key at <https://multihopper.com/developer/dashboard> and register your rewards
   wallet. Fund that wallet with a little SOL first: until it holds the rent-exempt minimum, `/prepare`
   fails with `MH_091`.
5. Ask in the [builder chat](https://t.me/multihopperbuilderportal) how your integration is identified for
   the challenge. The rules require this before volume counts.
6. Deploy to Vercel, set the env vars with `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet`, redeploy, and send a small
   real payout yourself before inviting anyone.

## Challenge evidence

```bash
MH_API_KEY=mh_live_... MH_API_BASE=https://multihopper.com npm run evidence -- 2026-10-21 2026-11-30
```

Writes a CSV of completed transfers (ids, signatures, timestamps, amounts) and a JSON summary with
qualifying volume per token, unique senders and repeat senders. Read-only.

See `docs/GO_TO_MARKET.md` for how to find the volume and `docs/SUBMISSION.md` for the entry draft.
