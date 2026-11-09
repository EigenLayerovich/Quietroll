"use client";

import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { call } from "@/lib/http";
import type { Cluster, Token } from "@/lib/tokens";

interface Config {
  mock: boolean;
  cluster: Cluster;
  tokens: Token[];
}

interface AppState {
  config: Config | null;
  /** Wallet with a verified server session, or null. */
  wallet: string | null;
  /** Address connected in the browser wallet (may not be signed in yet). */
  connected: string | null;
  busy: boolean;
  error: string | null;
  connect: () => void;
  signIn: () => Promise<void>;
  startDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  signAll: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <Providers>");
  return v;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function Inner({ children }: { children: ReactNode }) {
  const adapter = useWallet();
  const modal = useWalletModal();
  const [config, setConfig] = useState<Config | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Config>("/api/config").then(setConfig).catch(() => setError("Could not reach the server"));
    call<{ wallet: string | null }>("/api/auth/me").then((r) => setWallet(r.wallet)).catch(() => {});
  }, []);

  const connected = adapter.publicKey?.toBase58() ?? null;

  const authenticate = useCallback(async (address: string, sign: (msg: Uint8Array) => Promise<Uint8Array>) => {
    setBusy(true);
    setError(null);
    try {
      const ch = await call<{ message: string; issuedAt: number; nonce: string }>("/api/auth/challenge", {
        wallet: address,
      });
      const signature = await sign(new TextEncoder().encode(ch.message));
      await call("/api/auth/verify", {
        wallet: address,
        issuedAt: ch.issuedAt,
        nonce: ch.nonce,
        signature: toB64(signature),
      });
      setWallet(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const signIn = useCallback(async () => {
    if (!connected) return;
    if (!adapter.signMessage) {
      setError("This wallet cannot sign messages. Use Phantom, Solflare or Backpack.");
      return;
    }
    await authenticate(connected, adapter.signMessage);
  }, [adapter.signMessage, authenticate, connected]);

  // Demo mode only: a throwaway keypair so the product can be tried without
  // installing a wallet. The server refuses chain access in demo mode.
  const startDemo = useCallback(async () => {
    const kp = Keypair.generate();
    await authenticate(kp.publicKey.toBase58(), async (msg) => nacl.sign.detached(msg, kp.secretKey));
  }, [authenticate]);

  const signOut = useCallback(async () => {
    await call("/api/auth/logout", {}).catch(() => {});
    setWallet(null);
    await adapter.disconnect().catch(() => {});
  }, [adapter]);

  const signAll = useCallback(
    async (txs: VersionedTransaction[]) => {
      if (!adapter.signAllTransactions || connected !== wallet) {
        throw new Error("Reconnect the wallet you signed in with to approve this payout.");
      }
      return adapter.signAllTransactions(txs);
    },
    [adapter, connected, wallet],
  );

  const value = useMemo<AppState>(
    () => ({
      config,
      wallet,
      connected,
      busy,
      error,
      connect: () => modal.setVisible(true),
      signIn,
      startDemo,
      signOut,
      signAll,
    }),
    [config, wallet, connected, busy, error, modal, signIn, startDemo, signOut, signAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  // Wallets are discovered through the Wallet Standard, so no adapter list is
  // needed. The connection endpoint is unused: broadcasts go through /api/rpc.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Inner>{children}</Inner>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
