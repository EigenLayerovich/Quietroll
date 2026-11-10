import { LiveMhApi } from "./client";
import { MockMhApi } from "./mock";
import { CookieSimStore } from "./mock-cookie-store";
import type { MhApi } from "./types";

// One client per server instance. Neither implementation holds state in
// memory, so this is safe on serverless hosts.
const g = globalThis as unknown as { __qrMh?: MhApi };

export function mh(): MhApi {
  if (!g.__qrMh) {
    const key = process.env.MH_API_KEY?.trim();
    g.__qrMh = key
      ? new LiveMhApi(key, (process.env.MH_API_BASE ?? "https://devnet.multihopper.com").replace(/\/+$/, ""))
      : new MockMhApi(new CookieSimStore());
  }
  return g.__qrMh;
}

export * from "./types";
