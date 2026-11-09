export type Cluster = "devnet" | "mainnet";

export interface Token {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";

const SOL: Token = { symbol: "SOL", name: "Solana", mint: SOL_MINT, decimals: 9 };

const TOKENS: Record<Cluster, Token[]> = {
  mainnet: [
    { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    SOL,
    { symbol: "USDT", name: "Tether USD", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  ],
  devnet: [
    SOL,
    // Circle's devnet USDC (faucet.circle.com).
    { symbol: "USDC", name: "USD Coin (devnet)", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 },
  ],
};

export function cluster(): Cluster {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet" ? "mainnet" : "devnet";
}

export function tokensFor(c: Cluster): Token[] {
  return TOKENS[c];
}

export function findToken(c: Cluster, mint: string): Token | undefined {
  return TOKENS[c].find((t) => t.mint === mint);
}

export function explorerTx(c: Cluster, signature: string): string {
  return `https://solscan.io/tx/${signature}${c === "devnet" ? "?cluster=devnet" : ""}`;
}
