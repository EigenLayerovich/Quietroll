import { LiveMhApi } from "./client";
import { MockMhApi } from "./mock";
import type { MhApi } from "./types";

// Survive Next.js dev-server module reloads so the demo simulator keeps state.
const g = globalThis as unknown as { __qrMh?: MhApi };

export function mh(): MhApi {
  if (!g.__qrMh) {
    const key = process.env.MH_API_KEY?.trim();
    g.__qrMh = key
      ? new LiveMhApi(key, (process.env.MH_API_BASE ?? "https://devnet.multihopper.com").replace(/\/+$/, ""))
      : new MockMhApi();
  }
  return g.__qrMh;
}

export * from "./types";
