import { authed, ownedTransfer } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = authed(async ({ wallet, api }, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const t = await ownedTransfer(api, wallet, (await params).id);
  return api.prepare(t.id);
});
