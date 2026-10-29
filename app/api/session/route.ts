import { NextResponse, type NextRequest } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";
import { passcode, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/server/session";

// Tighter than the proxy's limit to slow passcode guessing.
const rateLimit = createRateLimiter(10, 60_000);

export async function POST(request: NextRequest) {
  const limited = rateLimit(clientIp(request));
  if (limited) return limited;

  const key = passcode();
  if (!key) return NextResponse.json({ error: "Access not configured" }, { status: 503 });

  const body: unknown = await request.json().catch(() => null);
  const attempt = (body as { passcode?: unknown } | null)?.passcode;
  if (typeof attempt !== "string" || !safeEqual(attempt, key)) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, sessionToken(key), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
