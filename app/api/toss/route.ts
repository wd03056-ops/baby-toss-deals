import { NextRequest, NextResponse } from "next/server";
import {
  fetchBestSelling,
  fetchCategories,
  fetchCategoryBestProducts,
  fetchTodayDeals,
  getAccessToken,
  TossApiError,
  type TossCategory,
  type TossOpenApiProduct,
} from "@/lib/toss-api";

/** @see docs — 목록 API는 하루 1회 갱신 권장, 서버는 1시간 캐시로 할당량 방어 */
const CACHE_TTL_MS = 3600_000;
const MAX_CACHE_SIZE = 100;
/** 하위 카테고리 병합·전체 페이징 — 이전 30건 캐시 무효화 */
const CACHE_VERSION = "v53-category-deep";

/**
 * 타입별 페이지 크기 — 문서 상한 (한 페이지 최대치로 수집)
 * best-selling / category-best: 1–100
 * today-deals: 1–30
 */
const BEST_PAGE_SIZE = 100;
const DAILY_PAGE_SIZE = 30;
const CATEGORY_BEST_PAGE_SIZE = 100;
/** hasNext가 끝날 때까지 수집. 커서 루프 안전 상한만 둠 */
const MAX_PAGES_PER_FEED = 50;
/** 카테고리+하위 카테고리 동시 조회 상한 (할당량 보호) */
const MAX_CATEGORY_IDS_PER_LOAD = 40;
const CATEGORY_FETCH_CONCURRENCY = 5;

const USE_MOCK_TOSS_API = false;

export type FeedType = "best" | "daily" | "categories" | "category-best";

type TossProduct = TossOpenApiProduct & {
  brandName?: string;
  categoryName?: string;
  categoryPath?: string;
};

type FlatCategory = {
  categoryId: number;
  displayName: string;
  level: number;
  path: string;
};

type ResponseCacheEntry = {
  expiresAt: number;
  body: Record<string, unknown>;
};

/** 1시간 fresh 캐시 — 탭 전환/새로고침 시 외부 API 미호출 */
const responseCache = new Map<string, ResponseCacheEntry>();
/** TTL 만료 후에도 유지 — 429/에러 시 폴백 */
const lastSuccessCache = new Map<string, Record<string, unknown>>();
/** 동일 cacheKey 동시 요청 합치기 (새로고침 폭주 방지) */
const inflightByKey = new Map<string, Promise<Record<string, unknown>>>();

const MOCK_PRODUCTS: TossProduct[] = [
  {
    tacaItemId: 900001,
    rank: 1,
    displayName: "[특가] 무선 이어폰 프로",
    brandName: "토스특가",
    thumbnailUrl:
      "https://placehold.co/400x500/F4E0A5/332E2B?text=Earphones",
    productUrl: "https://example.com/mock/earphones",
    displayPrice: 29900,
    originalPrice: 59900,
    discountRate: 50,
    isSoldOut: false,
    reviewScore: 4.8,
    reviewCount: 1284,
  },
  {
    tacaItemId: 900002,
    rank: 2,
    displayName: "스테인리스 텀블러 500ml",
    brandName: "토스특가",
    thumbnailUrl:
      "https://placehold.co/400x500/E8E2D9/332E2B?text=Tumbler",
    productUrl: "https://example.com/mock/tumbler",
    displayPrice: 14900,
    originalPrice: 25000,
    discountRate: 40,
    isSoldOut: false,
    reviewScore: 4.6,
    reviewCount: 512,
  },
];

function pruneExpiredCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now > entry.expiresAt) responseCache.delete(key);
  }
}

function evictLruIfNeeded() {
  while (responseCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey === undefined) break;
    responseCache.delete(oldestKey);
  }
}

function getFreshCache(key: string): Record<string, unknown> | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return { ...entry.body };
}

function getLastSuccess(key: string): Record<string, unknown> | null {
  const body = lastSuccessCache.get(key);
  return body ? { ...body } : null;
}

/** 성공·빈 배열([]) 모두 1시간 캐시 + lastSuccess 갱신 (재호출/폴링 차단) */
function setSuccessCache(key: string, body: Record<string, unknown>) {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  pruneExpiredCacheEntries();
  if (responseCache.has(key)) responseCache.delete(key);
  evictLruIfNeeded();
  responseCache.set(key, { expiresAt, body });
  lastSuccessCache.set(key, body);
}

/** 페이지 병합 시 동일 tacaItemId만 제거 — 그 외 상품은 제외하지 않음 */
function mergePages(products: TossProduct[]): TossProduct[] {
  const seen = new Set<number>();
  const out: TossProduct[] = [];
  for (const product of products) {
    if (product.tacaItemId) {
      if (seen.has(product.tacaItemId)) continue;
      seen.add(product.tacaItemId);
    }
    out.push(product);
  }
  return out;
}

type ListPageResult = {
  items: TossOpenApiProduct[];
  nextCursor: string | null;
  hasNext: boolean;
  category?: { categoryId: number; displayName: string };
};

function normalizeListPage(raw: ListPageResult): ListPageResult {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const nextCursor =
    typeof raw?.nextCursor === "string" && raw.nextCursor.trim()
      ? raw.nextCursor
      : null;
  // hasNext 누락 시 nextCursor 존재로 보완
  const hasNext = Boolean(raw?.hasNext) || Boolean(nextCursor);
  return {
    items,
    nextCursor,
    hasNext,
    category: raw?.category,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** 선택한 카테고리 + 모든 하위 categoryId (랭킹 30건 한계 보완) */
function collectCategoryIdsWithDescendants(
  tree: TossCategory[],
  targetId: number,
): number[] {
  const findNode = (nodes: TossCategory[]): TossCategory | null => {
    for (const node of nodes) {
      if (node.categoryId === targetId) return node;
      const hit = findNode(node.children ?? []);
      if (hit) return hit;
    }
    return null;
  };

  const flatten = (node: TossCategory): number[] => [
    node.categoryId,
    ...(node.children ?? []).flatMap(flatten),
  ];

  const target = findNode(tree);
  if (!target) return [targetId];
  const ids = flatten(target);
  return ids.slice(0, MAX_CATEGORY_IDS_PER_LOAD);
}

/**
 * cursor/hasNext로 가능한 모든 페이지를 병합.
 * 빈 페이지([])도 정상 종료 — 재시도 없음. slice/limit으로 자르지 않음.
 */
async function fetchAllPages(
  fetchPage: (cursor: string | null) => Promise<ListPageResult>,
  label: string,
): Promise<{ items: TossProduct[]; categoryName?: string; pages: number }> {
  const collected: TossProduct[] = [];
  let cursor: string | null = null;
  let categoryName: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES_PER_FEED) {
    const result = normalizeListPage(await fetchPage(cursor));
    pages += 1;
    categoryName = result.category?.displayName ?? categoryName;

    const batch = (result.items ?? []).map((item) => ({
      ...item,
      categoryName: result.category?.displayName ?? categoryName,
    }));
    collected.push(...batch);

    console.info("[/api/toss] page fetched", {
      label,
      page: pages,
      batch: batch.length,
      total: collected.length,
      hasNext: result.hasNext,
      nextCursor: result.nextCursor ? "yes" : "no",
    });

    if (!result.hasNext || !result.nextCursor) break;
    if (cursor === result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return { items: mergePages(collected), categoryName, pages };
}

function flattenCategories(
  categories: TossCategory[],
  parentPath: string[] = [],
): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const cat of categories) {
    const path = [...parentPath, cat.displayName];
    out.push({
      categoryId: cat.categoryId,
      displayName: cat.displayName,
      level: cat.level,
      path: path.join(" > "),
    });
    if (cat.children?.length) {
      out.push(...flattenCategories(cat.children, path));
    }
  }
  return out;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProduct(product: TossProduct) {
  const freeShipping =
    product.isFreeShipping === true ||
    product.freeShipping === true ||
    product.shippingFee === 0;

  const displayPrice = toSafeNumber(product.displayPrice, 0);
  const originalPrice = toSafeNumber(product.originalPrice, 0);
  const discountRate =
    originalPrice > 0 && displayPrice >= 0 && displayPrice < originalPrice
      ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100)
      : toSafeNumber(product.discountRate, 0);

  return {
    tacaItemId: toSafeNumber(product.tacaItemId, 0),
    productId: toSafeNumber(product.tacaItemId, 0),
    displayName:
      typeof product.displayName === "string" && product.displayName.trim()
        ? product.displayName
        : "상품명 없음",
    brandName: product.brandName || product.sellerName || "",
    thumbnailUrl:
      typeof product.thumbnailUrl === "string" ? product.thumbnailUrl : "",
    productUrl:
      typeof product.productUrl === "string" ? product.productUrl : "",
    displayPrice,
    originalPrice,
    discountRate,
    isSoldOut: Boolean(product.isSoldOut),
    endAt: product.endAt,
    rank: product.rank,
    reviewScore: toSafeNumber(product.reviewScore, 0),
    reviewCount: toSafeNumber(product.reviewCount, 0),
    isFreeShipping: freeShipping,
    shippingFee:
      typeof product.shippingFee === "number" && Number.isFinite(product.shippingFee)
        ? product.shippingFee
        : undefined,
    deliveryType: product.deliveryType || product.shippingType || "",
    categoryName: product.categoryName,
    categoryPath: product.categoryPath,
  };
}

function productListBody(
  type: FeedType,
  products: TossProduct[],
  extra?: Record<string, unknown>,
) {
  // 토스 목록 전체 반환 — slice/limit으로 자르지 않음
  const normalized = products.map(normalizeProduct).filter((p) => p.tacaItemId > 0);
  console.info("[/api/toss] response product count", {
    type,
    raw: products.length,
    normalized: normalized.length,
  });
  return {
    success: true as const,
    type,
    count: normalized.length,
    products: normalized,
    empty: normalized.length === 0,
    ...extra,
  };
}

function parseFeedType(raw: string | null): FeedType {
  if (raw === "daily") return "daily";
  if (raw === "categories") return "categories";
  if (raw === "category-best") return "category-best";
  return "best";
}

function buildCacheKey(type: FeedType, categoryId?: number): string {
  const base = `toss:${CACHE_VERSION}:${type}`;
  if (type === "category-best") {
    return `${base}:cat:${categoryId ?? "none"}${USE_MOCK_TOSS_API ? ":mock" : ""}`;
  }
  return `${base}${USE_MOCK_TOSS_API ? ":mock" : ""}`;
}

async function loadBest(accessToken: string): Promise<TossProduct[]> {
  const { items, pages } = await fetchAllPages(
    (cursor) =>
      fetchBestSelling(accessToken, { cursor, size: BEST_PAGE_SIZE }),
    "best-selling",
  );
  console.info("[/api/toss] best-selling complete", {
    count: items.length,
    pages,
    pageSize: BEST_PAGE_SIZE,
  });
  return items;
}

async function loadDaily(accessToken: string): Promise<TossProduct[]> {
  // today-deals size 상한 30 — 여러 페이지 병합
  const { items, pages } = await fetchAllPages(
    (cursor) =>
      fetchTodayDeals(accessToken, { cursor, size: DAILY_PAGE_SIZE }),
    "today-deals",
  );
  console.info("[/api/toss] today-deals complete", {
    count: items.length,
    pages,
    pageSize: DAILY_PAGE_SIZE,
  });
  return items;
}

async function loadCategories(accessToken: string) {
  const tree = await fetchCategories(accessToken);
  // 전체 카테고리 트리 — 특정 분야로 제한하지 않음
  const categories = flattenCategories(tree).map((c) => ({
    categoryId: c.categoryId,
    displayName: c.displayName,
    level: c.level,
    path: c.path,
  }));
  return {
    success: true as const,
    type: "categories" as const,
    count: categories.length,
    categories,
    empty: categories.length === 0,
  };
}

async function loadCategoryBest(
  accessToken: string,
  categoryId: number,
): Promise<{ products: TossProduct[]; categoryName?: string }> {
  // 상위 카테고리 단독 조회는 토스가 ~30건 + hasNext:false 로 끊는 경우가 많음
  // → 하위 카테고리 랭킹을 모아 전체 캐시로 병합한 뒤 전달
  const tree = await fetchCategories(accessToken);
  const categoryIds = collectCategoryIdsWithDescendants(tree, categoryId);

  console.info("[/api/toss] category-best expand", {
    categoryId,
    categoryIds: categoryIds.length,
  });

  const pageResults = await mapPool(
    categoryIds,
    CATEGORY_FETCH_CONCURRENCY,
    async (id) => {
      try {
        return await fetchAllPages(
          (cursor) =>
            fetchCategoryBestProducts(accessToken, id, {
              cursor,
              size: CATEGORY_BEST_PAGE_SIZE,
            }),
          `category-best:${id}`,
        );
      } catch (error) {
        console.warn("[/api/toss] category-best child failed", {
          categoryId: id,
          message: error instanceof Error ? error.message : String(error),
        });
        return { items: [] as TossProduct[], categoryName: undefined, pages: 0 };
      }
    },
  );

  const merged = mergePages(pageResults.flatMap((r) => r.items));
  const rootName =
    pageResults.find((r) => r.categoryName)?.categoryName ??
    pageResults[0]?.categoryName;

  console.info("[/api/toss] category-best complete", {
    categoryId,
    categoryName: rootName,
    sourceCategories: categoryIds.length,
    count: merged.length,
    pageSize: CATEGORY_BEST_PAGE_SIZE,
  });

  return { products: merged, categoryName: rootName };
}

async function buildFreshBody(
  type: FeedType,
  categoryId?: number,
): Promise<Record<string, unknown>> {
  if (USE_MOCK_TOSS_API) {
    if (type === "categories") {
      return {
        success: true,
        type,
        count: 2,
        categories: [
          {
            categoryId: 9001,
            displayName: "패션",
            level: 1,
            path: "패션",
          },
          {
            categoryId: 9002,
            displayName: "생활/가전",
            level: 1,
            path: "생활/가전",
          },
        ],
        empty: false,
      };
    }
    return productListBody(type, MOCK_PRODUCTS, {
      categoryId: type === "category-best" ? categoryId : undefined,
    });
  }

  const accessToken = await getAccessToken();

  if (type === "categories") {
    return loadCategories(accessToken);
  }

  if (type === "daily") {
    const products = await loadDaily(accessToken);
    return productListBody(type, products);
  }

  if (type === "category-best") {
    if (!categoryId || !Number.isFinite(categoryId)) {
      return {
        success: true,
        type,
        count: 0,
        products: [],
        empty: true,
        error: "categoryId가 필요합니다.",
      };
    }
    const { products, categoryName } = await loadCategoryBest(
      accessToken,
      categoryId,
    );
    return productListBody(type, products, { categoryId, categoryName });
  }

  // best
  const products = await loadBest(accessToken);
  return productListBody("best", products);
}

/**
 * fresh 캐시 HIT → 즉시 반환
 * MISS → 외부 API 1회 (inflight 합침) → 성공/빈배열 모두 1h 캐시
 * 실패 → lastSuccess 폴백 (앱 미중단)
 */
async function resolveCachedResponse(
  cacheKey: string,
  type: FeedType,
  categoryId?: number,
): Promise<{ body: Record<string, unknown>; cached: boolean; stale: boolean }> {
  const fresh = getFreshCache(cacheKey);
  if (fresh) {
    return { body: fresh, cached: true, stale: false };
  }

  const existing = inflightByKey.get(cacheKey);
  if (existing) {
    const body = await existing;
    return { body, cached: true, stale: false };
  }

  const promise = (async () => {
    try {
      const body = await buildFreshBody(type, categoryId);
      // 0건([]) 포함 — 정상 응답으로 1시간 캐시 (재호출 차단)
      setSuccessCache(cacheKey, body);
      return body;
    } catch (error) {
      const fallback = getLastSuccess(cacheKey);
      if (fallback) {
        console.warn("[/api/toss] upstream failed — serving lastSuccess", {
          cacheKey,
          type,
          status: error instanceof TossApiError ? error.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          ...fallback,
          stale: true,
          fallback: true,
        };
      }
      throw error;
    } finally {
      inflightByKey.delete(cacheKey);
    }
  })();

  inflightByKey.set(cacheKey, promise);
  const body = await promise;
  return {
    body,
    cached: Boolean(body.fallback),
    stale: Boolean(body.stale),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof TossApiError) {
    console.error("[/api/toss] TossApiError", {
      stage: error.stage,
      status: error.status,
      message: error.message,
      body: error.body,
    });
    const status =
      error.status === 429
        ? 429
        : error.status >= 400 && error.status < 600
          ? error.status
          : 502;
    return NextResponse.json(
      {
        success: false,
        stage: error.stage,
        error:
          typeof error.body === "object" &&
          error.body &&
          "error" in (error.body as object)
            ? (error.body as { error?: unknown }).error
            : error.message,
        detail: error.body,
      },
      { status },
    );
  }

  console.error("[/api/toss]", error);
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : "API 호출 실패",
    },
    { status: 500 },
  );
}

export const revalidate = 3600;

/**
 * GET /api/toss?type=best|daily|categories|category-best&categoryId=
 *
 * 방어:
 * 1) 클라이언트는 이 Route만 호출 (토스 직접 호출 금지)
 * 2) 타입별 cacheKey + 1시간 메모리 캐시
 * 3) 429/에러 → lastSuccess 폴백
 * 4) 빈 배열([])도 1시간 캐시, 재시도/폴링 없음
 *
 * @see https://sharelink-docs.toss.im/guide/open-api/api/best-selling
 * @see https://sharelink-docs.toss.im/guide/open-api/api/today-deals
 * @see https://sharelink-docs.toss.im/guide/open-api/api/categories
 * @see https://sharelink-docs.toss.im/guide/open-api/api/products
 */
export async function GET(request: NextRequest) {
  const type = parseFeedType(request.nextUrl.searchParams.get("type"));
  const categoryIdRaw = request.nextUrl.searchParams.get("categoryId");
  const categoryId = categoryIdRaw ? Number(categoryIdRaw) : undefined;
  const cacheKey = buildCacheKey(type, categoryId);

  try {
    const { body, cached, stale } = await resolveCachedResponse(
      cacheKey,
      type,
      categoryId,
    );

    return NextResponse.json({
      ...body,
      cached,
      stale,
      cacheKey,
      cacheTtlSec: 3600,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
