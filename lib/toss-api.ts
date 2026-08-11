/**
 * 토스쇼핑 쉐어링크 Open API 클라이언트
 * 공통 규약: https://sharelink-docs.toss.im/guide/open-api/convention
 */

const OAUTH_TOKEN_URL = "https://oauth2.cert.toss.im/token";
export const OPENAPI_BASE_URL = "https://sharelink.toss.im/openapi";

/** 파트너 단위 지속 한도 10 rps — 여유를 두고 조절 */
const MAX_RPS = 8;
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_RPS);

/** 재시도: 500 · HTTP 429 만 (규약) */
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 400;

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
let lastRequestAt = 0;
let rateLimitQueue: Promise<void> = Promise.resolve();

/** 동일 상품 재요청 시 기존 링크 재사용 (일 사용 상한·호출 제한 절약) */
const shareLinkCache = new Map<
  number,
  { shareUrl: string; shortUrl: string; originUrl: string; cachedAt: number }
>();

export const NON_RETRYABLE_ERROR_CODES = new Set([
  "INVALID_ARGUMENT",
  "SHARELINK_OPENAPI_ACCESS_DENIED",
  "SHARELINK_OPENAPI_QUOTA_EXCEEDED",
]);

export class TossApiError extends Error {
  status: number;
  body: unknown;
  errorCode?: string;
  reason?: string;
  retryAfterMs?: number;

  constructor(
    status: number,
    body: unknown,
    options?: { retryAfterMs?: number },
  ) {
    const parsed = parseTossErrorBody(body);
    super(parsed.reason || "Toss API Error");
    this.name = "TossApiError";
    this.status = status;
    this.body = body;
    this.errorCode = parsed.errorCode;
    this.reason = parsed.reason;
    this.retryAfterMs = options?.retryAfterMs;
  }

  /** 규약: QUOTA / INVALID / ACCESS_DENIED / 401 은 재시도하지 않음 */
  get retryable(): boolean {
    if (this.status === 401) return false;
    if (this.errorCode && NON_RETRYABLE_ERROR_CODES.has(this.errorCode)) {
      return false;
    }
    if (this.status === 429) return true;
    if (this.status === 500 || this.errorCode === "500") return true;
    return false;
  }
}

function parseTossErrorBody(body: unknown): {
  errorCode?: string;
  reason?: string;
} {
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;
  const error = obj.error;

  if (error && typeof error === "object") {
    const detail = error as { errorCode?: string; reason?: string };
    return {
      errorCode: detail.errorCode,
      reason: detail.reason,
    };
  }

  if (typeof obj.errorCode === "string") {
    return {
      errorCode: obj.errorCode,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
    };
  }

  return {};
}

export function parseJsonSafe(response: Response): Promise<unknown> {
  return response.text().then((text) => {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 전 엔드포인트 합산 10 rps 한도 준수 */
function scheduleRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = rateLimitQueue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });

  // 큐가 실패해도 이어지도록
  rateLimitQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

function getRetryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  if (header) {
    const asSeconds = Number(header);
    if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
      return asSeconds * 1000;
    }
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
  }
  // 지수 백오프 + 지터
  const expo = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 200);
  return expo + jitter;
}

/** Access Key / Secret Key로 액세스 토큰 발급 (재사용) */
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
    cache: "no-store",
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

/**
 * Bearer accessToken으로 Open API 호출
 * - 성공/실패는 resultType 으로 판별 (HTTP만으로 분기하지 않음)
 * - 500 · HTTP 429 는 지수 백오프 재시도 (Retry-After 우선)
 * - QUOTA / INVALID / ACCESS_DENIED / 401 은 재시도하지 않음
 */
export async function tossFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let lastError: TossApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const data = await scheduleRateLimited(async () => {
        const response = await fetch(`${OPENAPI_BASE_URL}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
          cache: "no-store",
        });

        const json = (await parseJsonSafe(response)) as TossApiResponse<T> | null;

        // 게이트웨이: 401 / 429 는 HTTP로 내려옴
        if (response.status === 401) {
          throw new TossApiError(401, json ?? { error: "UNAUTHORIZED" });
        }

        if (response.status === 429) {
          throw new TossApiError(429, json ?? { error: "TOO_MANY_REQUEST" }, {
            retryAfterMs: getRetryAfterMs(response, attempt),
          });
        }

        if (!response.ok && response.status >= 500) {
          throw new TossApiError(response.status, json, {
            retryAfterMs: getRetryAfterMs(response, attempt),
          });
        }

        if (!response.ok) {
          throw new TossApiError(response.status, json);
        }

        // 규약: HTTP 200이어도 resultType 으로 성공/실패 판별
        if (json && typeof json === "object" && "resultType" in json) {
          if (json.resultType === "FAIL") {
            const fail = json as TossApiFail;
            const code = fail.error?.errorCode;
            const status =
              code === "500"
                ? 500
                : fail.error?.errorType && fail.error.errorType >= 400
                  ? fail.error.errorType
                  : 200;

            throw new TossApiError(status, json, {
              retryAfterMs:
                code === "500"
                  ? getRetryAfterMs(response, attempt)
                  : undefined,
            });
          }

          // 모르는 필드는 무시 — success 본문만 반환
          return json.success;
        }

        throw new TossApiError(500, json ?? { error: "빈 응답" });
      });

      return data;
    } catch (error) {
      if (!(error instanceof TossApiError)) {
        throw error;
      }

      lastError = error;

      if (!error.retryable || attempt >= MAX_RETRIES) {
        throw error;
      }

      const waitMs =
        error.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 200;
      console.warn(
        `[tossFetch] retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(waitMs)}ms`,
        { path, status: error.status, errorCode: error.errorCode },
      );
      await sleep(waitMs);
    }
  }

  throw lastError ?? new TossApiError(500, { error: "재시도 실패" });
}

export type ShareLinkResult = {
  /** 상품 옵션 식별자 — 링크 발급·상세 조회의 기준 */
  tacaItemId: number;
  publisherId: string;
  /** 추적 링크(단축) — 게시/이동에 사용, 수익 집계됨 */
  shortUrl: string;
  /** 추적 링크(원본) — 수익 집계됨 */
  originUrl: string;
  /** shortUrl 우선, 없으면 originUrl */
  shareUrl: string;
};

/**
 * POST /openapi/links — 쉐어링크 발급
 * 규약: 반드시 tacaItemId 사용 (tacaId로 발급하면 대표 옵션 변경 시 링크가 갈라짐)
 * 같은 tacaItemId는 캐시·API 모두에서 기존 링크 재사용
 * 주의: productUrl은 추적이 없어 수익 집계되지 않음 → 반환하지 않음
 */
export async function createShareLink(
  tacaItemId: number,
): Promise<ShareLinkResult> {
  const publisherId = process.env.TOSS_PUBLISHER_ID;
  if (!publisherId) {
    throw new Error(
      "TOSS_PUBLISHER_ID 환경변수가 필요합니다. 쉐어링크 크리에이터 어드민에서 안내받은 퍼블리셔 UUID를 설정하세요.",
    );
  }

  if (!tacaItemId || Number.isNaN(tacaItemId) || tacaItemId <= 0) {
    throw new TossApiError(400, {
      resultType: "FAIL",
      error: {
        errorCode: "INVALID_ARGUMENT",
        reason: "유효한 tacaItemId가 필요합니다.",
      },
    });
  }

  const cached = shareLinkCache.get(tacaItemId);
  if (cached) {
    return {
      tacaItemId,
      publisherId,
      shortUrl: cached.shortUrl,
      originUrl: cached.originUrl,
      shareUrl: cached.shareUrl,
    };
  }

  const accessToken = await getAccessToken();

  // tacaId가 아닌 tacaItemId로만 발급 (용어 문서 권장)
  const link = await tossFetch<{
    tacaItemId: number;
    publisherId: string;
    shortUrl: string;
    originUrl: string;
  }>("/links", accessToken, {
    method: "POST",
    body: JSON.stringify({
      tacaItemId,
      publisherId,
    }),
  });

  const shareUrl = link.shortUrl || link.originUrl;

  shareLinkCache.set(tacaItemId, {
    shareUrl,
    shortUrl: link.shortUrl,
    originUrl: link.originUrl,
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

/** Next API 라우트용: 토스 에러 JSON을 규약에 맞게 반환 */
export function toTossErrorResponse(error: unknown): {
  status: number;
  body: unknown;
} {
  if (error instanceof TossApiError) {
    // 토스 FAIL 본문이 있으면 그대로 전달
    if (
      error.body &&
      typeof error.body === "object" &&
      "resultType" in (error.body as object)
    ) {
      return {
        status: error.status >= 400 ? error.status : 200,
        body: error.body,
      };
    }

    return {
      status: error.status >= 400 ? error.status : 500,
      body: {
        resultType: "FAIL",
        error: {
          errorCode: error.errorCode || String(error.status),
          reason: error.reason || error.message,
        },
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        resultType: "FAIL",
        error: {
          errorCode: "500",
          reason: error.message,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      resultType: "FAIL",
      error: {
        errorCode: "500",
        reason: "API 호출 실패",
      },
    },
  };
}
