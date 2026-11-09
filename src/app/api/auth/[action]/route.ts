import { NextResponse } from "next/server";
import { isValidWallet } from "@/lib/batch";
import { fail } from "@/lib/api";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  createSessionToken,
  issueChallenge,
  sessionWallet,
  verifyChallenge,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function hostOf(req: Request): string {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "quietroll";
}

export async function GET(_req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "me") return fail(404, "NOT_FOUND", "Unknown auth action");
  return NextResponse.json({ wallet: await sessionWallet() });
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const wallet = String(body.wallet ?? "");
  if (!isValidWallet(wallet)) return fail(400, "BAD_REQUEST", "Invalid wallet address");

  if (action === "challenge") {
    return NextResponse.json(issueChallenge(wallet, hostOf(req)));
  }

  if (action === "verify") {
    const ok = verifyChallenge({
      wallet,
      issuedAt: Number(body.issuedAt),
      nonce: String(body.nonce ?? ""),
      signature: String(body.signature ?? ""),
      host: hostOf(req),
    });
    if (!ok) return fail(401, "BAD_SIGNATURE", "Signature could not be verified. Try signing in again.");
    const res = NextResponse.json({ wallet });
    res.cookies.set(SESSION_COOKIE, createSessionToken(wallet), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });
    return res;
  }

  return fail(404, "NOT_FOUND", "Unknown auth action");
}
