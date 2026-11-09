import { NextResponse } from "next/server";
import { mh, MhError, type MhApi, type Transfer } from "./mh";
import { sessionWallet } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Wrap a route handler: require a signed-in wallet and turn MultiHopper and
 * validation failures into one consistent `{ error: { code, message } }` shape.
 */
export function authed<A extends unknown[]>(
  fn: (ctx: { wallet: string; api: MhApi }, ...args: A) => Promise<unknown>,
) {
  return async (...args: A) => {
    try {
      const wallet = await sessionWallet();
      if (!wallet) return fail(401, "UNAUTHENTICATED", "Sign in with your wallet first");
      const body = await fn({ wallet, api: mh() }, ...args);
      return body instanceof Response ? body : NextResponse.json(body);
    } catch (e) {
      if (e instanceof MhError) return fail(e.status >= 400 && e.status < 600 ? e.status : 502, e.code, e.message);
      if (e instanceof HttpError) return fail(e.status, e.code, e.message);
      console.error("[quietroll] unhandled route error", e);
      return fail(500, "INTERNAL", "Something went wrong. Nothing was sent; try again.");
    }
  };
}

/** Load a transfer and confirm it was created by the signed-in wallet. */
export async function ownedTransfer(api: MhApi, wallet: string, id: string): Promise<Transfer> {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "BAD_REQUEST", "Invalid transfer id");
  const t = await api.getTransfer(n);
  // Same response as "not found" so ids of other customers cannot be probed.
  if (t.sourceOwner !== wallet) throw new MhError("MH_030", "Transfer not found", 404);
  return t;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be JSON");
  }
}
