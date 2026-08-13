/**
 * 앱인토스 WebView(.ait)에는 Next Route Handler가 포함되지 않습니다.
 * 배포 API origin 을 NEXT_PUBLIC_API_BASE_URL 로 지정하세요.
 * 로컬 `next dev` 에서는 빈 값 → 동일 출처 `/api/...` 사용.
 */
export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * base + path 결합 시 슬래시 중복/누락 방지
 * - base: https://xxx.vercel.app  → https://xxx.vercel.app/api/toss
 * - base: ""                      → /api/toss
 */
export function apiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  const normalized = `/${String(path ?? "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")}`;

  if (!baseUrl) return normalized;
  return `${baseUrl}${normalized}`;
}
