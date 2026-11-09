// Types for the MultiHopper REST API (https://dev-docs.multihopper.com).
// Only the fields this app reads are typed; unknown fields pass through.

export type TransferStatus =
  | "quote"
  | "awaiting_signature"
  | "processing"
  | "active"
  | "completed"
  | "failed"
  | "expired"
  | "refunded";

export interface Destination {
  wallet: string;
  amountRaw: string;
  status?: "pending" | "paid";
  payoutSignature?: string | null;
  paidAt?: string | null;
}

export interface Transfer {
  id: number;
  externalId?: string | null;
  supportBundleId?: string | null;
  tokenMint: string;
  tokenSymbol?: string | null;
  amountRaw: string;
  amountTokens: string;
  sourceOwner: string;
  recipientWallet?: string | null;
  destinationCount?: number | null;
  destinations?: Destination[] | null;
  hops: number;
  arrivalSeconds: number;
  percentFeeBps?: number | null;
  percentFeeRaw?: string;
  totalFlatFeeLamports?: number | null;
  recipientReceivesRaw?: string;
  status: TransferStatus;
  phase?: string;
  progress?: { hopsCompleted: number; hopsTotal: number };
  lastError?: { code: string; message: string; at?: string } | null;
  signatures?: { routeInit?: string[]; sessionInit?: string[]; hops?: string[] };
  isTest: boolean;
  createdAt: string;
  completedAt?: string | null;
  expiresAt?: string | null;
}

export interface FeeEstimate {
  tier: string;
  percentFeeBps: number;
  percentFeeRaw: string;
  totalFlatFeeLamports: number;
  hopAmountRaw: string;
  usdEquivalent?: number;
  priceSource?: string;
  cappedAtTierBoundary?: boolean;
  sol: {
    requiredSolUpFrontLamports: number;
    refundableLamports?: number;
    netCostLamports?: number;
    breakdown?: Record<string, number>;
  };
  isTestMode?: boolean;
}

export interface EstimateRequest {
  tokenMint: string;
  amountRaw: string;
  tokenDecimals: number;
  hops?: number;
  destinationCount?: number;
  arrivalSeconds?: number;
}

export interface CreateTransferRequest {
  tokenMint: string;
  amountRaw: string;
  amountTokens: string;
  tokenDecimals: number;
  tokenSymbol?: string;
  sourceOwner: string;
  recipientWallet?: string;
  destinations?: { wallet: string; amountRaw: string }[];
  hops?: number;
  arrivalSeconds?: number;
  externalId?: string;
}

export interface PreparedTxBundle {
  keeperFundingTx: string | null;
  routeInitTxs: { base64: string }[] | null;
  orchestratorInitTx: string | null;
  sessionInitTxs: string[] | null;
  dispersionInitTxs: string[] | null;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  resume?: { nothingToDo?: boolean; routeAlreadyDeployed?: boolean };
}

export interface PrepareResponse {
  transfer: Transfer;
  preparedTxs: PreparedTxBundle;
}

export interface ConfirmBroadcastRequest {
  routeInitSignatures: string[];
  keeperFundingSignature?: string;
  orchestratorInitSignature?: string;
  sessionInitSignatures?: string[];
  dispersionInitSignatures?: string[];
}

export interface TransferList {
  items: Transfer[];
  pagination: { total: number; limit: number; offset: number };
}

export interface UsageSummary {
  totalTransfers: number;
  completedTransfers: number;
  failedTransfers: number;
  totalVolumeRaw: string;
  totalFlatFeeEarned: number;
  tokenFeesEarned: { tokenMint: string; tokenDecimals: number; amountRaw: string }[];
  totalPayouts: number;
  isTestMode: boolean;
}

/** An API failure carrying MultiHopper's structured MH_xxx code. */
export class MhError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "MhError";
  }
}

/** The surface both the live client and the demo simulator implement. */
export interface MhApi {
  readonly mock: boolean;
  estimate(req: EstimateRequest): Promise<FeeEstimate>;
  createTransfer(req: CreateTransferRequest): Promise<Transfer>;
  prepare(id: number): Promise<PrepareResponse>;
  confirmBroadcast(id: number, body: ConfirmBroadcastRequest): Promise<Transfer>;
  getTransfer(id: number): Promise<Transfer>;
  getByExternalId(externalId: string): Promise<Transfer>;
  listTransfers(q: { limit?: number; offset?: number; fromDate?: string }): Promise<TransferList>;
  usage(q: { fromDate?: string; toDate?: string }): Promise<UsageSummary>;
}
