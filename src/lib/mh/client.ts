import { randomUUID } from "node:crypto";
import {
  MhError,
  type ConfirmBroadcastRequest,
  type CreateTransferRequest,
  type EstimateRequest,
  type FeeEstimate,
  type MhApi,
  type PrepareResponse,
  type Transfer,
  type TransferList,
  type UsageSummary,
} from "./types";

/**
 * Server-side MultiHopper client. The API key never reaches the browser:
 * the app's own route handlers call this and enforce wallet ownership.
 */
export class LiveMhApi implements MhApi {
  readonly mock = false;

  constructor(
    private apiKey: string,
    private base: string,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = { "x-api-key": this.apiKey };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      // Every POST mutation requires a fresh idempotency key (MH_070).
      headers["Idempotency-Key"] = randomUUID();
    }
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    // Back off once or twice on rate limits and brief unavailability.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 15) * 1000));
      return this.call<T>(method, path, body, attempt + 1);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new MhError("MH_090", `MultiHopper returned a non-JSON response (HTTP ${res.status})`, 502);
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error;
      throw new MhError(err?.code ?? "MH_090", err?.message ?? `HTTP ${res.status}`, res.status);
    }
    return json as T;
  }

  estimate(req: EstimateRequest) {
    return this.call<FeeEstimate>("POST", "/transfers/estimate", req);
  }

  createTransfer(req: CreateTransferRequest) {
    return this.call<Transfer>("POST", "/transfers", req);
  }

  prepare(id: number) {
    return this.call<PrepareResponse>("POST", `/transfers/${id}/prepare`);
  }

  async confirmBroadcast(id: number, body: ConfirmBroadcastRequest) {
    const r = await this.call<{ transfer: Transfer }>("POST", `/transfers/${id}/confirm-broadcast`, body);
    return r.transfer;
  }

  // The reference documents a bare Transfer here while one guide shows
  // `{ transfer }`; accept either so a server-side change cannot break us.
  private unwrap(r: Transfer | { transfer: Transfer }): Transfer {
    return "transfer" in r && r.transfer ? r.transfer : (r as Transfer);
  }

  async getTransfer(id: number) {
    return this.unwrap(await this.call<Transfer | { transfer: Transfer }>("GET", `/transfers/${id}`));
  }

  async getByExternalId(externalId: string) {
    return this.unwrap(
      await this.call<Transfer | { transfer: Transfer }>(
        "GET",
        `/transfers/by-external/${encodeURIComponent(externalId)}`,
      ),
    );
  }

  listTransfers(q: { limit?: number; offset?: number; fromDate?: string }) {
    const p = new URLSearchParams();
    if (q.limit) p.set("limit", String(q.limit));
    if (q.offset) p.set("offset", String(q.offset));
    if (q.fromDate) p.set("fromDate", q.fromDate);
    return this.call<TransferList>("GET", `/transfers?${p}`);
  }

  usage(q: { fromDate?: string; toDate?: string }) {
    const p = new URLSearchParams();
    if (q.fromDate) p.set("fromDate", q.fromDate);
    if (q.toDate) p.set("toDate", q.toDate);
    return this.call<UsageSummary>("GET", `/usage?${p}`);
  }
}
