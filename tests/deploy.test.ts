import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { decodeTx, orderBundle } from "@/lib/deploy";

const BLOCKHASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

describe("orderBundle", () => {
  it("emits the mandatory broadcast order and skips what is already on chain", () => {
    const order = orderBundle({
      sessionInitTxs: ["s1", "s2"],
      dispersionInitTxs: ["d1"],
      orchestratorInitTx: "o",
      routeInitTxs: [{ base64: "r1" }, { base64: "r2" }],
      keeperFundingTx: "k",
      recentBlockhash: "x",
      lastValidBlockHeight: 1,
    });
    expect(order.map((o) => o.base64)).toEqual(["k", "r1", "r2", "o", "s1", "s2", "d1"]);

    const resumed = orderBundle({
      keeperFundingTx: null, routeInitTxs: null, orchestratorInitTx: null,
      sessionInitTxs: ["s2"], dispersionInitTxs: null, recentBlockhash: "x", lastValidBlockHeight: 1,
    });
    expect(resumed.map((o) => o.group)).toEqual(["session"]);
  });
});

describe("decodeTx", () => {
  const user = Keypair.generate();
  const ephemeral = Keypair.generate();
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: user.publicKey,
      newAccountPubkey: ephemeral.publicKey,
      lamports: 1_000_000,
      space: 0,
      programId: SystemProgram.programId,
    }),
  ];

  function verifyAll(tx: VersionedTransaction) {
    const msg = tx.message.serialize();
    const keys = tx.message.staticAccountKeys;
    tx.signatures.forEach((sig, i) => expect(nacl.sign.detached.verify(msg, sig, keys[i].toBytes())).toBe(true));
  }

  it("keeps the server's ephemeral signature when the user signs a v0 transaction", () => {
    const message = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message();
    const server = new VersionedTransaction(message);
    server.sign([ephemeral]); // server pre-signs; the user's slot stays empty
    const tx = decodeTx(Buffer.from(server.serialize()).toString("base64"));
    expect(tx.signatures).toHaveLength(2);
    tx.sign([user]); // what a wallet does
    verifyAll(tx);
  });

  it("reads a legacy-format transaction (orchestratorInitTx) through the same path", () => {
    const legacy = new Transaction({ feePayer: user.publicKey, recentBlockhash: BLOCKHASH }).add(...ixs);
    legacy.partialSign(ephemeral);
    const b64 = legacy.serialize({ requireAllSignatures: false }).toString("base64");
    const tx = decodeTx(b64);
    expect(tx.version).toBe("legacy");
    tx.sign([user]);
    verifyAll(tx);
    // And it still round-trips as a legacy transaction for the cluster.
    expect(Transaction.from(Buffer.from(tx.serialize())).verifySignatures()).toBe(true);
  });
});
