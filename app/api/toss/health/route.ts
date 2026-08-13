import { corsJson, corsPreflight } from "@/lib/cors";
import { resolveTossCredentials } from "@/lib/toss-api";

export const dynamic = "force-dynamic";

function mask(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

/**
 * GET /api/toss/health
 * 시크릿 값은 노출하지 않고, Vercel 환경변수·인증 설정 여부만 확인합니다.
 */
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  const { clientId, clientSecret } = resolveTossCredentials();
  const publisherId = (process.env.TOSS_PUBLISHER_ID ?? "").trim();

  const credentialsOk = Boolean(clientId && clientSecret);
  const publisherOk = Boolean(publisherId);

  return corsJson({
    success: true,
    auth: {
      /** OAuth client_id ← TOSS_ACCESS_KEY (또는 TOSS_CLIENT_ID / TOSS_CLIENT_KEY) */
      accessKeyConfigured: Boolean(clientId),
      accessKeyPreview: mask(clientId),
      /** OAuth client_secret ← TOSS_SECRET_KEY (또는 TOSS_CLIENT_SECRET) */
      secretKeyConfigured: Boolean(clientSecret),
      secretKeyPreview: mask(clientSecret),
      /** 쉐어링크 발급용 */
      publisherIdConfigured: publisherOk,
      publisherIdPreview: mask(publisherId),
      credentialsOk,
    },
    openApi: {
      tokenUrl: "https://oauth2.cert.toss.im/token",
      baseUrl: "https://sharelink.toss.im/openapi",
      authorizationHeader: "Authorization: Bearer {access_token}",
      scopes: ["sharelink:read", "sharelink:write"],
    },
    accessDeniedHint: {
      errorCode: "SHARELINK_OPENAPI_ACCESS_DENIED",
      meaning:
        "등록되지 않은 출발지 IP에서 Open API를 호출했거나, 어드민에 IP가 하나도 없을 때 발생합니다.",
      actions: [
        "Vercel Environment Variables에 TOSS_ACCESS_KEY / TOSS_SECRET_KEY / TOSS_PUBLISHER_ID 등록 후 Redeploy",
        "sharelink.toss.im 어드민 → API 연동에 Vercel 서버 출발지 IP 등록",
        "로컬 PC IP가 아니라 API를 호출하는 서버(Vercel) IP를 등록",
      ],
    },
  });
}
