import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { checkInternalKey } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/internal/accounts/[clientId]">
) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { clientId } = await ctx.params;

  const accounts = await prisma.socialAccount.findMany({
    where: { clientId, status: "active" },
    select: {
      id: true,
      platform: true,
      externalId: true,
      accessTokenEnc: true,
      dailyPostLimit: true,
    },
  });

  const result = accounts.map((a) => {
    let token: string;
    try {
      token = decryptToken(a.accessTokenEnc);
    } catch {
      token = "";
    }
    return {
      id: a.id,
      platform: a.platform,
      externalId: a.externalId,
      token,
      dailyPostLimit: a.dailyPostLimit,
    };
  });

  return Response.json(result);
}
