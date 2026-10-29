import type { NextRequest } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";
import { requireSession } from "@/lib/server/session";
import { proxyTMDB } from "@/lib/server/tmdb";

const rateLimit = createRateLimiter(60, 60_000);

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const denied = rateLimit(clientIp(request)) ?? requireSession(request);
  if (denied) return denied;
  return proxyTMDB((await params).path, request.nextUrl.searchParams);
}
