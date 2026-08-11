const OAUTH_TOKEN_URL = "https://oauth2.cert.toss.im/token";
export const OPENAPI_BASE_URL = "https://sharelink.toss.im/openapi";

/** 외부 fetch 공통: 1시간 캐시로 Rate Limit 방어 */
export const FETCH_REVALIDATE_SECONDS = 3600;

type TossApiSuccess<T> = {
  resultType: "SUCCESS";
  success: T;
};

type TossApiFail = {
  resultType: "FAIL";
  error: {
    errorType?: number;
    errorCode: string;
    reason: string;
  };
};

type TossApiResponse<T> = TossApiSuccess<T> | TossApiFail;

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

/** 동일 상품 재클릭 시 불필요한 발급 호출을 줄이기 위한 캐시 */
const shareLinkCache = new Map<number, { shareUrl: string; cachedAt: number }>();
const SHARE_LINK_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24시간

export class TossApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super("Toss API Error");
    this.name = "TossApiError";
    this.status = status;
    this.body = body;
  }
}

export async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

/** Access Key / Secret Key로 액세스 토큰 발급 */
export async function getAccessToken(): Promise<string> {
  const accessKey = process.env.TOSS_ACCESS_KEY;
  const secretKey = process.env.TOSS_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error(
      "TOSS_ACCESS_KEY와 TOSS_SECRET_KEY 환경변수가 필요합니다.",
    );
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: accessKey,
    client_secret: secretKey,
    scope: "sharelink:read sharelink:write",
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    next: { revalidate: FETCH_REVALIDATE_SECONDS },
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new TossApiError(response.status, data);
  }

  const tokenPayload = data as {
    access_token?: string;
    expires_in?: number;
  };

  if (!tokenPayload.access_token) {
    throw new TossApiError(response.status || 500, data);
  }

  tokenCache = {
    accessToken: tokenPayload.access_token,
    expiresAt: now + (tokenPayload.expires_in ?? 3600) * 1000,
  };

  return tokenPayload.access_token;
}

/** Bearer accessToken으로 Open API 호출 */
export async function tossFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${OPENAPI_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    next: { revalidate: FETCH_REVALIDATE_SECONDS },
  });

  const data = (await parseJsonSafe(response)) as TossApiResponse<T> | null;

  if (!response.ok) {
    throw new TossApiError(response.status, data);
  }

  if (data && typeof data === "object" && "resultType" in data) {
    if (data.resultType === "FAIL") {
      throw new TossApiError(200, data);
    }
    return data.success;
  }

  throw new TossApiError(500, data ?? { error: "빈 응답" });
}

export type ShareLinkResult = {
  tacaItemId: number;
  publisherId: string;
  shortUrl: string;
  originUrl: string;
  shareUrl: string;
};

/**
 * POST /openapi/links — 상품 쉐어링크 실시간 발급
 * productId는 tacaItemId로 매핑합니다.
 */
export async function createShareLink(
  productId: number,
): Promise<ShareLinkResult> {
  const publisherId = process.env.TOSS_PUBLISHER_ID;
  if (!publisherId) {
    throw new Error(
      "TOSS_PUBLISHER_ID 환경변수가 필요합니다. 쉐어링크 크리에이터 어드민에서 안내받은 퍼블리셔 UUID를 설정하세요.",
    );
  }

  const cached = shareLinkCache.get(productId);
  if (cached && Date.now() - cached.cachedAt < SHARE_LINK_CACHE_TTL_MS) {
    return {
      tacaItemId: productId,
      publisherId,
      shortUrl: cached.shareUrl,
      originUrl: cached.shareUrl,
      shareUrl: cached.shareUrl,
    };
  }

  const accessToken = await getAccessToken();

  const link = await tossFetch<{
    tacaItemId: number;
    publisherId: string;
    shortUrl: string;
    originUrl: string;
  }>("/links", accessToken, {
    method: "POST",
    body: JSON.stringify({
      tacaItemId: productId,
      publisherId,
    }),
  });

  const shareUrl = link.shortUrl || link.originUrl;

  shareLinkCache.set(productId, {
    shareUrl,
    cachedAt: Date.now(),
  });

  return {
    tacaItemId: link.tacaItemId,
    publisherId: link.publisherId,
    shortUrl: link.shortUrl,
    originUrl: link.originUrl,
    shareUrl,
  };
}
