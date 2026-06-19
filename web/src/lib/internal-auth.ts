import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Validates the x-internal-key header against INTERNAL_API_KEY using a
 * constant-time comparison to avoid timing attacks.
 * Returns a 401 Response if invalid, or null if authorized.
 */
export function checkInternalKey(req: NextRequest): Response | null {
  const provided = req.headers.get("x-internal-key") ?? "";
  const expected = process.env.INTERNAL_API_KEY ?? "";

  if (!expected) {
    return Response.json(
      { error: "INTERNAL_API_KEY not configured" },
      { status: 500 }
    );
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
