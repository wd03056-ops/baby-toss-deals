/**
 * 토스쇼핑 쉐어링크 Open API 클라이언트
 * @see https://sharelink-docs.toss.im/guide/open-api/auth
 * @see https://sharelink-docs.toss.im/guide/open-api/readme
 * @see https://sharelink-docs.toss.im/guide/open-api/convention
 */

const OAUTH_TOKEN_URL = "https://oauth2.cert.toss.im/token";
export const OPENAPI_BASE_URL = "https://sharelink.toss.im/openapi";

/** Open API 응답 캐시는 route.ts in-memory 캐시에 맡김 — fetch 레이어는 no-store */
const NO_STORE = { cache: "no-store" as const };

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
/** 동시에 여러 요청이 토큰을 발급하지 않도록 */
let tokenInflight: Promise<string> | null = null;

/** 동일 상품 재클릭 시 불필요한 발급 호출을 줄이기 위한 캐시 */
const shareLinkCache = new Map<number, { shareUrl: string; cachedAt: number }>();
const SHARE_LINK_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24시간

export class TossApiError extends Error {
  status: number;
  body: unknown;
  stage: "token" | "openapi" | "config";

  constructor(
    status: number,
    body: unknown,
    stage: "token" | "openapi" | "config" = "openapi",
    message = "Toss API Error",
  ) {
    super(message);
    this.name = "TossApiError";
    this.status = status;
    this.body = body;
    this.stage = stage;
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

function maskSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

/**
 * 공식 문서: Access Key = client_id, Secret Key = client_secret
 * 프로젝트에서는 TOSS_ACCESS_KEY / TOSS_SECRET_KEY 사용.
 * 일부 표기(TOSS_CLIENT_ID 등)도 호환.
 */
export function resolveTossCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = (
    process.env.TOSS_ACCESS_KEY ||
    process.env.TOSS_CLIENT_ID ||
    process.env.TOSS_CLIENT_KEY ||
    ""
  ).trim();

  const clientSecret = (
    process.env.TOSS_SECRET_KEY ||
    process.env.TOSS_CLIENT_SECRET ||
    ""
  ).trim();

  return { clientId, clientSecret };
}

function assertCredentialsConfigured(clientId: string, clientSecret: string) {
  if (!clientId || !clientSecret) {
    throw new TossApiError(
      500,
      {
        error:
          "토스 API 인증 환경변수가 없습니다. TOSS_ACCESS_KEY / TOSS_SECRET_KEY 를 .env.local에 설정하세요.",
        checkedKeys: [
          "TOSS_ACCESS_KEY",
          "TOSS_SECRET_KEY",
          "TOSS_CLIENT_ID",
          "TOSS_CLIENT_KEY",
          "TOSS_CLIENT_SECRET",
        ],
      },
      "config",
      "Missing Toss API credentials",
    );
  }

  if (
    clientId.includes("your_") ||
    clientSecret.includes("your_") ||
    clientId === "your_access_key"
  ) {
    throw new TossApiError(
      500,
      {
        error:
          "플레이스홀더 키가 감지되었습니다. sharelink.toss.im 어드민에서 발급한 실제 Access/Secret Key로 교체하세요.",
      },
      "config",
      "Placeholder Toss API credentials",
    );
  }
}

function clearTokenCache() {
  tokenCache = null;
}

/**
 * Access Key / Secret Key로 액세스 토큰 발급
 * POST https://oauth2.cert.toss.im/token
 * Content-Type: application/x-www-form-urlencoded
 * body: grant_type, client_id, client_secret, scope
 */
export async function getAccessToken(options?: {
  forceRefresh?: boolean;
}): Promise<string> {
  const { clientId, clientSecret } = resolveTossCredentials();
  assertCredentialsConfigured(clientId, clientSecret);

  const now = Date.now();
  if (
    !options?.forceRefresh &&
    tokenCache &&
    tokenCache.expiresAt > now + 60_000
  ) {
    return tokenCache.accessToken;
  }

  if (!options?.forceRefresh && tokenInflight) {
    return tokenInflight;
  }

  tokenInflight = (async () => {
    // 공식 curl과 동일: scope는 공백으로 구분한 read/write
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "sharelink:read sharelink:write",
    });

    console.info("[toss-api] requesting access token", {
      url: OAUTH_TOKEN_URL,
      grant_type: "client_credentials",
      client_id: maskSecret(clientId),
      client_secret: maskSecret(clientSecret),
      scope: "sharelink:read sharelink:write",
      forceRefresh: Boolean(options?.forceRefresh),
    });

    let response: Response;
    try {
      response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        ...NO_STORE,
      });
    } catch (networkError) {
      console.error("[toss-api] token fetch network error", networkError);
      throw new TossApiError(
        502,
        {
          error: "토큰 발급 서버에 연결하지 못했습니다.",
          detail:
            networkError instanceof Error
              ? networkError.message
              : String(networkError),
        },
        "token",
        "Token endpoint network error",
      );
    }

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      console.error("[toss-api] token issue failed", {
        status: response.status,
        statusText: response.statusText,
        body: data,
        hint:
          response.status === 401
            ? "Access Key/Secret Key가 틀렸거나 재발급 후 구 Secret을 쓰는 중일 수 있습니다. 어드민에서 키를 확인하세요."
            : "토큰 엔드포인트 응답을 확인하세요.",
      });
      clearTokenCache();
      throw new TossApiError(
        response.status,
        {
          stage: "token",
          status: response.status,
          body: data,
          hint:
            "토큰 발급 실패. TOSS_ACCESS_KEY(=client_id), TOSS_SECRET_KEY(=client_secret) 와 어드민 Secret 재발급 여부를 확인하세요.",
        },
        "token",
        `Token issue failed (${response.status})`,
      );
    }

    const tokenPayload = data as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };

    if (!tokenPayload.access_token) {
      console.error("[toss-api] token response missing access_token", data);
      clearTokenCache();
      throw new TossApiError(
        500,
        { stage: "token", body: data, error: "access_token 없음" },
        "token",
        "Token response missing access_token",
      );
    }

    const expiresInSec = tokenPayload.expires_in ?? 3600;
    tokenCache = {
      accessToken: tokenPayload.access_token,
      expiresAt: Date.now() + expiresInSec * 1000,
    };

    console.info("[toss-api] access token issued", {
      token_type: tokenPayload.token_type ?? "Bearer",
      scope: tokenPayload.scope,
      expires_in: expiresInSec,
      tokenPreview: maskSecret(tokenPayload.access_token),
    });

    return tokenPayload.access_token;
  })();

  try {
    return await tokenInflight;
  } finally {
    tokenInflight = null;
  }
}

type TossFetchOptions = RequestInit & {
  /**
   * GET 목록 API: Next.js Data Cache 1시간 (할당량 방어)
   * 토큰/링크 발급 등: no-store
   */
  cacheMode?: "revalidate" | "no-store";
};

/**
 * Bearer accessToken으로 Open API 호출
 * Authorization: Bearer {access_token}  (공식 규약)
 */
export async function tossFetch<T>(
  path: string,
  accessToken: string,
  init?: TossFetchOptions,
): Promise<T> {
  const url = `${OPENAPI_BASE_URL}${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  const { cacheMode, ...restInit } = init ?? {};
  const useRevalidate =
    (cacheMode ?? (method === "GET" ? "revalidate" : "no-store")) ===
    "revalidate";

  const doRequest = async (token: string) => {
    const response = await fetch(url, {
      ...restInit,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(method !== "GET" && method !== "HEAD"
          ? { "Content-Type": "application/json" }
          : {}),
        ...(restInit.headers ?? {}),
      },
      ...(useRevalidate
        ? { next: { revalidate: 3600 } }
        : NO_STORE),
    });

    const data = (await parseJsonSafe(response)) as TossApiResponse<T> | null;
    return { response, data };
  };

  let { response, data } = await doRequest(accessToken);

  // 게이트웨이 HTTP 401: 토큰 무효/만료 → 1회 강제 재발급 후 재시도
  if (response.status === 401) {
    console.warn("[toss-api] openapi 401 — refreshing token and retrying once", {
      path,
      body: data,
    });
    clearTokenCache();
    try {
      const fresh = await getAccessToken({ forceRefresh: true });
      ({ response, data } = await doRequest(fresh));
    } catch (refreshError) {
      console.error("[toss-api] token refresh after 401 failed", refreshError);
      throw refreshError instanceof TossApiError
        ? refreshError
        : new TossApiError(
            401,
            {
              stage: "token",
              openapiBody: data,
              refreshError:
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError),
            },
            "token",
            "Token refresh failed after OpenAPI 401",
          );
    }
  }

  if (!response.ok) {
    console.error("[toss-api] openapi HTTP error", {
      path,
      status: response.status,
      body: data,
      hint:
        response.status === 401
          ? "토큰이 유효하지 않습니다. 키/시크릿을 확인하세요."
          : response.status === 403
            ? "출발지 IP가 어드민에 등록됐는지 확인하세요 (로컬 PC IP ≠ 서버 IP)."
            : undefined,
    });
    throw new TossApiError(
      response.status,
      {
        stage: "openapi",
        path,
        status: response.status,
        body: data,
      },
      "openapi",
      `OpenAPI HTTP ${response.status}`,
    );
  }

  if (data && typeof data === "object" && "resultType" in data) {
    if (data.resultType === "FAIL") {
      console.error("[toss-api] openapi resultType=FAIL", {
        path,
        error: data.error,
        hint:
          data.error?.errorCode === "SHARELINK_OPENAPI_ACCESS_DENIED"
            ? "인증 정보 또는 등록되지 않은 출발지 IP입니다. sharelink.toss.im 어드민에서 서버 IP를 등록하세요."
            : undefined,
      });
      throw new TossApiError(200, data, "openapi", data.error?.reason ?? "FAIL");
    }
    return data.success;
  }

  throw new TossApiError(
    500,
    { stage: "openapi", path, body: data, error: "빈 응답" },
    "openapi",
    "Empty OpenAPI response",
  );
}

/** @see https://sharelink-docs.toss.im/guide/open-api/api/categories */
export type TossCategory = {
  categoryId: number;
  level: number;
  displayName: string;
  children: TossCategory[];
};

/**
 * 상품 카드 공통 필드 (목록 API)
 * @see https://sharelink-docs.toss.im/guide/open-api/convention.md
 * 스키마는 하위호환으로 확장될 수 있음 — 모르는 필드는 무시/전달
 */
export type TossOpenApiProduct = {
  rank?: number;
  tacaItemId: number;
  displayName: string;
  thumbnailUrl: string;
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  /** 리뷰 평점 */
  reviewScore?: number;
  /** 리뷰 수 */
  reviewCount?: number;
  endAt?: string;
  brandName?: string;
  /** 확장 필드(응답에 있을 때만) — 배송/판매자 등 */
  isFreeShipping?: boolean;
  freeShipping?: boolean;
  shippingFee?: number;
  deliveryType?: string;
  shippingType?: string;
  sellerName?: string;
};

/** @see https://sharelink-docs.toss.im/guide/open-api/api/products */
export type CategoryBestProductsResult = {
  category?: {
    categoryId: number;
    displayName: string;
  };
  items: TossOpenApiProduct[];
  nextCursor: string | null;
  hasNext: boolean;
};

/**
 * GET /openapi/categories — 카테고리 트리 조회
 * @see https://sharelink-docs.toss.im/guide/open-api/api/categories
 */
export async function fetchCategories(
  accessToken: string,
): Promise<TossCategory[]> {
  const result = await tossFetch<{ categories: TossCategory[] }>(
    "/categories",
    accessToken,
    { cacheMode: "revalidate" },
  );
  return result.categories ?? [];
}

export type ProductListPage = {
  items: TossOpenApiProduct[];
  nextCursor: string | null;
  hasNext: boolean;
};

/**
 * GET /openapi/products/best-categories/{categoryId}
 * 카테고리별 상품 목록 (커서 페이징, size 1–100)
 * @see https://sharelink-docs.toss.im/guide/open-api/api/products
 */
export async function fetchCategoryBestProducts(
  accessToken: string,
  categoryId: number,
  options?: { cursor?: string | null; size?: number },
): Promise<CategoryBestProductsResult> {
  const size = Math.min(100, Math.max(1, options?.size ?? 100));
  const query = new URLSearchParams({ size: String(size) });
  if (options?.cursor) {
    query.set("cursor", options.cursor);
  }

  return tossFetch<CategoryBestProductsResult>(
    `/products/best-categories/${categoryId}?${query.toString()}`,
    accessToken,
    // 앱 서버 1h 캐시가 본캐시 — Next Data Cache는 커서 페이지 오염 방지 위해 no-store
    { cacheMode: "no-store" },
  );
}

/**
 * GET /openapi/products/best-selling — 통합 베스트
 * @see https://sharelink-docs.toss.im/guide/open-api/api/best-selling
 */
export async function fetchBestSelling(
  accessToken: string,
  options?: { cursor?: string | null; size?: number },
): Promise<ProductListPage> {
  const size = Math.min(100, Math.max(1, options?.size ?? 100));
  const query = new URLSearchParams({ size: String(size) });
  if (options?.cursor) {
    query.set("cursor", options.cursor);
  }

  return tossFetch<ProductListPage>(
    `/products/best-selling?${query.toString()}`,
    accessToken,
    { cacheMode: "no-store" },
  );
}

/**
 * GET /openapi/products/today-deals — 하루특가 (size 1–30)
 * @see https://sharelink-docs.toss.im/guide/open-api/api/today-deals
 */
export async function fetchTodayDeals(
  accessToken: string,
  options?: { cursor?: string | null; size?: number },
): Promise<ProductListPage> {
  const size = Math.min(30, Math.max(1, options?.size ?? 30));
  const query = new URLSearchParams({ size: String(size) });
  if (options?.cursor) {
    query.set("cursor", options.cursor);
  }

  return tossFetch<ProductListPage>(
    `/products/today-deals?${query.toString()}`,
    accessToken,
    { cacheMode: "no-store" },
  );
}

/**
 * 상품 상세 (목록 카드 + 상세 이미지)
 * @see https://sharelink-docs.toss.im/guide/open-api/api/product-detail
 */
export type TossProductDetail = {
  tacaItemId: number;
  tacaId?: number;
  displayName: string;
  thumbnailUrl: string;
  mainImageUrls?: string[];
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  reviewScore?: number;
  reviewCount?: number;
  brandName?: string;
  description?: {
    detailImageUrls?: string[];
    noticeImageUrl?: string | null;
    htmlUrl?: string | null;
  };
};

export type ProductDetailResult = {
  items: TossProductDetail[];
  notFoundIds: number[];
};

/**
 * GET /openapi/products/detail?tacaItemIds=
 * 한 번에 최대 30건. 단일 조회는 tacaItemId 1개만 전달.
 */
export async function fetchProductDetails(
  accessToken: string,
  tacaItemIds: number[],
): Promise<ProductDetailResult> {
  const ids = [...new Set(tacaItemIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return { items: [], notFoundIds: [] };
  }
  if (ids.length > 30) {
    throw new TossApiError(
      400,
      { error: "tacaItemIds는 한 번에 최대 30건까지입니다." },
      "openapi",
      "Too many tacaItemIds",
    );
  }

  const query = new URLSearchParams({
    tacaItemIds: ids.join(","),
  });

  const result = await tossFetch<ProductDetailResult>(
    `/products/detail?${query.toString()}`,
    accessToken,
    { cacheMode: "revalidate" },
  );

  return {
    items: result.items ?? [],
    notFoundIds: result.notFoundIds ?? [],
  };
}

/** 단일 상품 상세 — 없으면 null (notFound, 재시도 불필요) */
export async function fetchProductDetailById(
  accessToken: string,
  tacaItemId: number,
): Promise<TossProductDetail | null> {
  const { items, notFoundIds } = await fetchProductDetails(accessToken, [
    tacaItemId,
  ]);
  if (notFoundIds.includes(tacaItemId)) return null;
  return items.find((item) => item.tacaItemId === tacaItemId) ?? items[0] ?? null;
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
 *
 * 수익 집계는 이 API로 발급한 shortUrl/originUrl 만 가능합니다.
 * 목록/상세의 productUrl 은 추적되지 않으므로 절대 구매 링크로 쓰지 마세요.
 * @see https://sharelink-docs.toss.im/guide/open-api/api/link.md
 */
export async function createShareLink(
  tacaItemId: number,
): Promise<ShareLinkResult> {
  if (!Number.isFinite(tacaItemId) || tacaItemId <= 0) {
    throw new TossApiError(
      400,
      { error: "유효한 tacaItemId가 필요합니다." },
      "config",
      "Invalid tacaItemId",
    );
  }

  const publisherId = process.env.TOSS_PUBLISHER_ID?.trim();
  if (!publisherId) {
    throw new TossApiError(
      500,
      {
        error:
          "TOSS_PUBLISHER_ID 환경변수가 필요합니다. 쉐어링크 크리에이터 어드민에서 안내받은 퍼블리셔 UUID를 설정하세요.",
      },
      "config",
      "Missing TOSS_PUBLISHER_ID",
    );
  }

  const cached = shareLinkCache.get(tacaItemId);
  if (cached && Date.now() - cached.cachedAt < SHARE_LINK_CACHE_TTL_MS) {
    return {
      tacaItemId,
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
    cacheMode: "no-store",
    body: JSON.stringify({
      tacaItemId,
      publisherId,
    }),
  });

  // shortUrl 우선 (게시·공유용). originUrl 도 동일하게 추적됨
  const shareUrl = (link.shortUrl || link.originUrl || "").trim();
  if (!shareUrl) {
    throw new TossApiError(
      502,
      { error: "쉐어링크 응답에 URL이 없습니다.", body: link },
      "openapi",
      "Empty share link URL",
    );
  }

  shareLinkCache.set(tacaItemId, {
    shareUrl,
    cachedAt: Date.now(),
  });

  console.info("[toss-api] share link issued", {
    tacaItemId: link.tacaItemId ?? tacaItemId,
    hasShortUrl: Boolean(link.shortUrl),
  });

  return {
    tacaItemId: link.tacaItemId ?? tacaItemId,
    publisherId: link.publisherId || publisherId,
    shortUrl: link.shortUrl || shareUrl,
    originUrl: link.originUrl || shareUrl,
    shareUrl,
  };
}
