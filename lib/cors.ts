import { NextResponse } from "next/server";

/** 앱인토스 WebView(tossmini.com) → Vercel API 교차 출처 허용 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function corsJson(
  body: unknown,
  init?: { status?: number; headers?: HeadersInit },
): NextResponse {
  const response = NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
  return withCors(response);
}

/** Preflight — OPTIONS 는 본문 없이 200 */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}
