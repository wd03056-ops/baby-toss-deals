import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, TossApiError, tossFetch } from "@/lib/toss-api";

/**
 * 아기·부모(육아용품) 엄격 필터 키워드
 * API는 1회만 호출하고, 아래 키워드로 JS filter 합니다.
 */
const BABY_PRODUCT_KEYWORDS = [
  "아기",
  "유아",
  "신생아",
  "베이비",
  "키즈",
  "어린이",
  "기저귀",
  "분유",
  "이유식",
  "간식",
  "젖병",
  "물티슈",
  "세제",
  "로션",
  "매트",
  "장난감",
  "완구",
  "유모차",
  "카시트",
  "아기옷",
  "내복",
  "임산부",
  "출산",
  "육아",
  "아기띠",
  "바디슈트",
  "스위머바스",
  "딸랑이",
  "치발기",
] as const;

const PRODUCT_FETCH_SIZE = 100;
const TODAY_DEALS_PAGE_SIZE = 30;
/** 응답 메모리 캐시 1시간 (빈 배열은 캐시하지 않음) */
const RESPONSE_CACHE_TTL_MS = 3600_000;
const CACHE_VERSION = "v6-keywords-extra";

type TossProduct = {
  rank?: number;
  tacaItemId: number;
  displayName: string;
  thumbnailUrl: string;
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  reviewScore?: number;
  reviewCount?: number;
  endAt?: string;
  shortUrl?: string;
  brandName?: string;
  salesCount?: number;
  viewCount?: number;
  commentCount?: number;
  createdAt?: string;
};

type ProductListResult = {
  items: TossProduct[];
  nextCursor: string | null;
  hasNext: boolean;
};

type ResponseCacheEntry = {
  expiresAt: number;
  body: Record<string, unknown>;
};

const responseCache = new Map<string, ResponseCacheEntry>();

function getResponseCache(key: string): Record<string, unknown> | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.body;
}

/** 실제 상품이 1개 이상일 때만 캐시 (빈 배열 미캐시) */
function setResponseCache(key: string, body: Record<string, unknown>) {
  const products = body.products;
  if (!Array.isArray(products) || products.length === 0) return;

  responseCache.set(key, {
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    body,
  });
}

function tossErrorResponse(error: unknown) {
  if (error instanceof TossApiError) {
    return NextResponse.json(error.body, { status: error.status });
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: false, error: "API 호출 실패" },
    { status: 500 },
  );
}

function matchesAnyKeyword(text: string, keywords: readonly string[]) {
  const normalized = text.replace(/\s/g, "");
  return keywords.some((keyword) =>
    normalized.includes(keyword.replace(/\s/g, "")),
  );
}

function productSearchText(product: TossProduct) {
  return [product.displayName, product.brandName].filter(Boolean).join(" ");
}

/** 제목/브랜드에 육아 키워드가 있는 상품만 */
function isBabyRelatedProduct(product: TossProduct) {
  return matchesAnyKeyword(productSearchText(product), BABY_PRODUCT_KEYWORDS);
}

/** 특가·할인 조건 (하루특가) */
function isActiveDeal(product: TossProduct) {
  const hasDiscount =
    product.discountRate > 0 ||
    (product.originalPrice > 0 &&
      product.displayPrice > 0 &&
      product.originalPrice > product.displayPrice);

  if (!hasDiscount && !product.endAt) {
    // today-deals API 자체 특가 목록이면 endAt/할인이 없어도 특가로 간주
    return true;
  }

  if (product.endAt) {
    const end = Date.parse(product.endAt);
    if (!Number.isNaN(end) && end <= Date.now()) return false;
  }

  return true;
}

function dedupeByTacaItemId(products: TossProduct[]): TossProduct[] {
  const map = new Map<number, TossProduct>();
  for (const product of products) {
    if (!product.tacaItemId || map.has(product.tacaItemId)) continue;
    map.set(product.tacaItemId, product);
  }
  return [...map.values()];
}

/** API 1회 호출 */
async function fetchOnce(
  path: string,
  accessToken: string,
  pageSize: number,
): Promise<TossProduct[]> {
  const separator = path.includes("?") ? "&" : "?";
  const query = new URLSearchParams({
    size: String(pageSize),
    limit: String(pageSize),
  });

  const result = await tossFetch<ProductListResult>(
    `${path}${separator}${query.toString()}`,
    accessToken,
  );

  return result.items ?? [];
}

/**
 * 하루특가: today-deals 1회 → 육아 키워드 + 특가 조건 filter
 * 더미 데이터 생성 없음
 */
async function collectDailyDeals(accessToken: string): Promise<TossProduct[]> {
  const allDeals = await fetchOnce(
    "/products/today-deals",
    accessToken,
    TODAY_DEALS_PAGE_SIZE,
  );

  return dedupeByTacaItemId(
    allDeals.filter(
      (product) => isBabyRelatedProduct(product) && isActiveDeal(product),
    ),
  );
}

/**
 * 인기상품: best-selling 1회 → 육아 키워드 filter → tacaItemId 중복 제거
 * 더미 데이터 생성 없음
 */
async function collectBestProducts(accessToken: string): Promise<TossProduct[]> {
  const allBest = await fetchOnce(
    "/products/best-selling",
    accessToken,
    PRODUCT_FETCH_SIZE,
  );

  return dedupeByTacaItemId(allBest.filter((product) => isBabyRelatedProduct(product)));
}

function normalizeProduct(product: TossProduct) {
  return {
    tacaItemId: product.tacaItemId,
    productId: product.tacaItemId,
    displayName: product.displayName,
    brandName: product.brandName || "",
    thumbnailUrl: product.thumbnailUrl,
    productUrl: product.productUrl,
    displayPrice: product.displayPrice,
    originalPrice: product.originalPrice,
    discountRate: product.discountRate,
    isSoldOut: product.isSoldOut,
    endAt: product.endAt,
    rank: product.rank,
    reviewScore: product.reviewScore ?? 0,
    reviewCount: product.reviewCount ?? 0,
    salesCount: product.salesCount,
    viewCount: product.viewCount,
    commentCount: product.commentCount,
    createdAt: product.createdAt,
  };
}

export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const type =
    request.nextUrl.searchParams.get("type") === "daily" ? "daily" : "best";
  const cacheKey = `toss:products:${CACHE_VERSION}:${type}`;

  const cached = getResponseCache(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const accessToken = await getAccessToken();

    const products =
      type === "daily"
        ? await collectDailyDeals(accessToken)
        : await collectBestProducts(accessToken);

    const body = {
      success: true as const,
      count: products.length,
      products: products.map(normalizeProduct),
    };

    setResponseCache(cacheKey, body);

    return NextResponse.json(body);
  } catch (error) {
    console.error("[/api/toss]", error);
    // 실패 시 더미 데이터 없이 에러만 반환 (프론트는 스켈레톤/에러 UI)
    return tossErrorResponse(error);
  }
}
