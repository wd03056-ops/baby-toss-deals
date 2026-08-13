/**
 * 앱인토스 WebView(.ait)에는 Next Route Handler가 포함되지 않습니다.
 * 배포 API origin 을 NEXT_PUBLIC_API_BASE_URL 로 지정하세요.
 * 로컬 `next dev` 에서는 빈 값 → 동일 출처 `/api/...` 사용.
 */
export function apiUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
