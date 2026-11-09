import { authed, ownedTransfer } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = authed(async ({ wallet, api }, _req: Request, { params }: { params: Promise<{ id: string }> }) =>
  ownedTransfer(api, wallet, (await params).id),
);
