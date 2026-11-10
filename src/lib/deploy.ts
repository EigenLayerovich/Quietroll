"use client";

// Deploys one route: fetch the unsigned bundle, have the user's wallet sign
// it (one approval), broadcast in the order the protocol requires, and report
// the signatures. Keys never leave the wallet; this app never has custody.

import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { ApiError, call, rpc } from "./http";
import type { PrepareResponse, Transfer } from "./mh/types";

export type DeployStep = "preparing" | "signing" | "broadcasting" | "confirming";

export interface DeployDeps {
  mock: boolean;
  signAll: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
  onStep: (step: DeployStep, detail?: string) => void;
}

type Group = "keeper" | "route" | "orchestrator" | "session" | "dispersion";

const GROUP_LABEL: Record<Group, string> = {
  keeper: "Funding keeper",
  route: "Creating route",
  orchestrator: "Scheduling",
  session: "Initialising hops",
  dispersion: "Binding recipients",
};

class BlockhashExpired extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/**
 * Flatten a /prepare bundle into the mandatory broadcast order:
 * keeperFundingTx -> routeInitTxs -> orchestratorInitTx -> sessionInitTxs -> dispersionInitTxs.
 * Null or empty groups are already on chain and are skipped.
 */
export function orderBundle(p: PrepareResponse["preparedTxs"]): { group: Group; base64: string }[] {
  const out: { group: Group; base64: string }[] = [];
  if (p.keeperFundingTx) out.push({ group: "keeper", base64: p.keeperFundingTx });
  for (const e of p.routeInitTxs ?? []) out.push({ group: "route", base64: typeof e === "string" ? e : e.base64 });
  if (p.orchestratorInitTx) out.push({ group: "orchestrator", base64: p.orchestratorInitTx });
  for (const b of p.sessionInitTxs ?? []) out.push({ group: "session", base64: b });
  for (const b of p.dispersionInitTxs ?? []) out.push({ group: "dispersion", base64: b });
  return out;
}

/**
 * Deserialize a prepared transaction. Some are pre-signed by the server with
 * ephemeral keys; VersionedTransaction keeps those signatures in place and
 * the wallet only fills the sender's slot. It also reads legacy-format
 * messages (orchestratorInitTx), so one code path covers the whole bundle.
 */
export function decodeTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(b64ToBytes(base64));
}

async function sendAndConfirm(tx: VersionedTransaction): Promise<string> {
  const signature = bs58.encode(tx.signatures[0]);
  try {
    await rpc<string>("sendTransaction", [
      bytesToB64(tx.serialize()),
      { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already been processed/i.test(msg)) return signature;
    if (/blockhash not found|block height exceeded|expired/i.test(msg)) throw new BlockhashExpired(msg);
    throw e;
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(1500);
    const r = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [
      [signature],
    ]);
    const s = r.value?.[0];
    if (s?.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return signature;
  }
  throw new BlockhashExpired("Transaction was not confirmed before its blockhash expired");
}

const RUNNING = ["processing", "active", "completed"];

export async function deployTransfer(transferId: number, deps: DeployDeps): Promise<Transfer> {
  const sigs = { keeper: undefined as string | undefined, route: [] as string[], orchestrator: undefined as string | undefined, session: [] as string[], dispersion: [] as string[] };
  const confirm = (body: Record<string, unknown>) => call<Transfer>(`/api/transfers/${transferId}/confirm`, body);
  const MAX_ATTEMPTS = 4;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    deps.onStep("preparing");
    // /prepare is resumable: after a partial broadcast it returns a fresh
    // blockhash and only the groups that are still missing on chain.
    const { transfer, preparedTxs } = await call<PrepareResponse>(`/api/transfers/${transferId}/prepare`, {});
    // Trust the bundle, not the status: the API reports `processing` as soon
    // as it sees the keeper funding, while the route itself may still be
    // undeployed. Only an empty bundle means there is nothing left to send.
    const pending = orderBundle(preparedTxs);
    if (pending.length === 0 && RUNNING.includes(transfer.status)) return transfer;
    if (pending.length > 0) {
      deps.onStep("signing", `${pending.length} transaction${pending.length === 1 ? "" : "s"}, one approval`);
      const signed = deps.mock ? [] : await deps.signAll(pending.map((p) => decodeTx(p.base64)));

      try {
        for (let i = 0; i < pending.length; i++) {
          const { group } = pending[i];
          deps.onStep("broadcasting", `${GROUP_LABEL[group]} (${i + 1}/${pending.length})`);
          let sig: string;
          if (deps.mock) {
            await sleep(350);
            sig = bs58.encode(crypto.getRandomValues(new Uint8Array(64)));
          } else {
            sig = await sendAndConfirm(signed[i]);
          }
          if (group === "keeper") {
            sigs.keeper = sig;
            // Record keeper funding immediately so an interrupted deploy can
            // never be asked to fund the keeper twice.
            // For multi-destination routes the API answers MH_041 here until
            // the recipients are bound; the funding is still found on chain
            // by the next /prepare or confirm, so that answer is not an error.
            await confirm({ routeInitSignatures: [], keeperFundingSignature: sig }).catch((e) => {
              if (!(e instanceof ApiError && e.code === "MH_041")) throw e;
            });
          } else if (group === "orchestrator") sigs.orchestrator = sig;
          else sigs[group].push(sig);

          // Later transactions read accounts the earlier ones created; give
          // RPC nodes a moment to see them (per MultiHopper's guidance).
          const next = pending[i + 1]?.group;
          if (!deps.mock && (group === "route" || group === "orchestrator") && next) await sleep(3000);
        }
      } catch (e) {
        if (e instanceof BlockhashExpired && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }

    deps.onStep("confirming");
    try {
      return await confirm({
        routeInitSignatures: sigs.route,
        keeperFundingSignature: sigs.keeper,
        orchestratorInitSignature: sigs.orchestrator,
        sessionInitSignatures: sigs.session,
        dispersionInitSignatures: sigs.dispersion,
      });
    } catch (e) {
      // MH_041 / MH_036: part of the bundle is not visible on chain yet.
      // Re-prepare to learn exactly what is missing and send only that.
      if (e instanceof ApiError && (e.code === "MH_041" || e.code === "MH_036") && attempt < MAX_ATTEMPTS) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not finish deploying this route. Nothing is lost: press Send again to resume.");
}
