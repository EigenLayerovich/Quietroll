import { NextResponse } from "next/server";
import { mh } from "@/lib/mh";
import { cluster, tokensFor } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export function GET() {
  const c = cluster();
  return NextResponse.json({ mock: mh().mock, cluster: c, tokens: tokensFor(c) });
}
