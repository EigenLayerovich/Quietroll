// Keeps demo-mode transfers in the visitor's own cookies instead of server
// memory. Serverless hosts (Vercel) run each request on whichever instance is
// free, so anything held in memory is lost or missing from one call to the
// next; a cookie travels with every request and makes the demo stateless.

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { cookies } from "next/headers";
import { DEMO_MAX_ROUTES } from "../batch";
import type { SimState, SimStore } from "./mock";

const PREFIX = "qr_demo_";
const MAX_AGE_S = 7 * 24 * 60 * 60;

export function encodeSim(state: SimState): string {
  return deflateRawSync(JSON.stringify(state)).toString("base64url");
}

export function decodeSim(value: string): SimState | null {
  try {
    const s = JSON.parse(inflateRawSync(Buffer.from(value, "base64url")).toString()) as SimState;
    return Number.isSafeInteger(s.id) && typeof s.sourceOwner === "string" ? s : null;
  } catch {
    return null;
  }
}

export class CookieSimStore implements SimStore {
  async all(): Promise<SimState[]> {
    const jar = await cookies();
    return jar
      .getAll()
      .filter((c) => c.name.startsWith(PREFIX))
      .map((c) => decodeSim(c.value))
      .filter((s): s is SimState => s !== null);
  }

  async put(state: SimState): Promise<void> {
    const jar = await cookies();
    jar.set(PREFIX + state.id, encodeSim(state), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_S,
    });
    // Browsers and hosts cap total cookie size, so keep only the newest runs.
    const others = (await this.all()).filter((s) => s.id !== state.id).sort((a, b) => b.id - a.id);
    for (const old of others.slice(DEMO_MAX_ROUTES - 1)) jar.delete(PREFIX + old.id);
  }
}
