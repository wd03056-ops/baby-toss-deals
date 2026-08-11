import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  TossApiError,
  tossFetch,
  toTossErrorResponse,
} from "@/lib/toss-api";

/** 카테고리 이름에 포함되면 수집 대상인 육아/아기 관련 키워드 */
const BABY_CATEGORY_KEYWORDS = [
  "유아",
  "아동",
  "아기",
  "출산",
  "베이비",
  "키즈",
  "임산부",
  "분유",
  "이유식",
  "아동의류",
  "유아동",
  "육아",
  "신생아",
  "젖병",
  "기저귀",
  "유모차",
  "카시트",
  "장난감",
  "맘",
  "베베",
] as const;

/** 아기 카테고리가 부족할 때 보완용 (상품은 키워드 필터 후 포함) */
const FALLBACK_CATEGORY_KEYWORDS = [
  "가전",
  "생활",
  "식품",
  "패션",
  "의류",
  "주방",
  "홈",
] as const;

/** 제목/카테고리에 있으면 우선 포함할 키워드 */
const PRIORITY_PRODUCT_KEYWORDS = [
  "유아",
  "육아",
  "아동",
  "임산부",
  "식기",
  "세제",
  "물티슈",
  "가습기",
  "기저귀",
  "분유",
  "이유식",
  "젖병",
  "유모차",
  "카시트",
  "아기",
  "베이비",
  "키즈",
  "장난감",
  "출산",
  "신생아",
  "아동복",
  "내의",
] as const;

const BABY_PRODUCT_REGEX = new RegExp(PRIORITY_PRODUCT_KEYWORDS.join("|"));

const PRODUCT_FETCH_SIZE = 100; // 베스트/전체 목록 API size 상한
const TODAY_DEALS_PAGE_SIZE = 30; // today-deals API는 size 최대 30
const UI_PAGE_SIZE = 20;
const MIN_PRODUCT_COUNT = 50;
const TARGET_PRODUCT_COUNT = 100;
const MAX_PAGES_PER_CATEGORY = 2;
/** Rate Limit(10 rps) 방지: 전역 큐와 함께 동시성 1 + 간격 */
const CATEGORY_FETCH_CONCURRENCY = 1;
const CATEGORY_FETCH_DELAY_MS = 120;
const PAGE_FETCH_DELAY_MS = 120;
/** 너무 많은 카테고리 호출로 타임아웃나지 않도록 상한 */
const MAX_BABY_CATEGORY_FETCHES = 15;
/**
 * 캐시 TTL (규약: 응답 저장·재사용, 랭킹은 하루 1회 갱신)
 * - best: 12시간
 * - daily: 10분 (특가 종료 시각 고려)
 */
const BEST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DAILY_CACHE_TTL_MS = 10 * 60 * 1000;
const CATEGORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  payload: T;
};

const responseCache = new Map<string, CacheEntry<unknown>>();
/** 같은 키로 동시에 들어오는 요청은 한 번만 토스 API를 치도록 공유 */
const inflightRequests = new Map<string, Promise<unknown>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCache<T>(key: string, payload: T, ttlMs: number) {
  responseCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    payload,
  });
}

async function getOrFetchCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const cached = getCached<T>(key);
  if (cached) {
    return { data: cached, cached: true };
  }

  const existing = inflightRequests.get(key) as Promise<T> | undefined;
  if (existing) {
    const data = await existing;
    return { data, cached: true };
  }

  const promise = fetcher()
    .then((data) => {
      setCache(key, data, ttlMs);
      inflightRequests.delete(key);
      return data;
    })
    .catch((error) => {
      inflightRequests.delete(key);
      throw error;
    });

  inflightRequests.set(key, promise);
  const data = await promise;
  return { data, cached: false };
}

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

type TossCategory = {
  categoryId: number;
  level: number;
  displayName: string;
  children: TossCategory[];
};

function tossErrorResponse(error: unknown) {
  const { status, body } = toTossErrorResponse(error);
  return NextResponse.json(body, { status });
}

type ProductWithCategory = TossProduct & { categoryName?: string };

type ProductListResult = {
  items: TossProduct[];
  nextCursor: string | null;
  hasNext: boolean;
  category?: { categoryId: number; displayName: string };
};

type MatchedCategory = {
  categoryId: number;
  displayName: string;
  level: number;
  priority: number; // 낮을수록 우선
};

function matchesAnyKeyword(text: string, keywords: readonly string[]) {
  const normalized = text.replace(/\s/g, "");
  return keywords.some((keyword) => {
    const key = keyword.replace(/\s/g, "");
    // "분유/이유식"처럼 슬래시로 묶인 키워드도 각각 매칭
    if (key.includes("/")) {
      return key.split("/").some((part) => part && normalized.includes(part));
    }
    return normalized.includes(key);
  });
}

/** 카테고리 트리 전체에서 육아/아기 관련 카테고리 ID를 모두 수집합니다. */
function findBabyCategories(categories: TossCategory[]): MatchedCategory[] {
  const matched: MatchedCategory[] = [];
  const seen = new Set<number>();
  const queue = [...categories];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const name = current.displayName ?? "";

    if (
      matchesAnyKeyword(name, BABY_CATEGORY_KEYWORDS) &&
      !seen.has(current.categoryId)
    ) {
      seen.add(current.categoryId);
      matched.push({
        categoryId: current.categoryId,
        displayName: name,
        level: current.level,
        // 상위(넓은) 카테고리부터 우선 조회해 상품 수를 확보
        priority: current.level,
      });
    }

    if (current.children?.length) {
      queue.push(...current.children);
    }
  }

  return matched.sort((a, b) => a.priority - b.priority || a.categoryId - b.categoryId);
}

/** 보완용 연관 카테고리 (가전/생활/식품/패션 등) */
function findFallbackCategories(categories: TossCategory[]): MatchedCategory[] {
  const matched: MatchedCategory[] = [];
  const seen = new Set<number>();
  const queue = [...categories];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const name = current.displayName ?? "";

    // 이미 아기 키워드 카테고리면 제외 (중복 방지)
    if (matchesAnyKeyword(name, BABY_CATEGORY_KEYWORDS)) {
      if (current.children?.length) queue.push(...current.children);
      continue;
    }

    if (
      matchesAnyKeyword(name, FALLBACK_CATEGORY_KEYWORDS) &&
      current.level <= 2 &&
      !seen.has(current.categoryId)
    ) {
      seen.add(current.categoryId);
      matched.push({
        categoryId: current.categoryId,
        displayName: name,
        level: current.level,
        priority: 100 + current.level,
      });
    }

    if (current.children?.length) {
      queue.push(...current.children);
    }
  }

  return matched.sort((a, b) => a.priority - b.priority);
}

function productSearchText(product: TossProduct, categoryName = "") {
  return [product.displayName, product.brandName, categoryName]
    .filter(Boolean)
    .join(" ");
}

function isPriorityProduct(product: TossProduct, categoryName = "") {
  return BABY_PRODUCT_REGEX.test(productSearchText(product, categoryName));
}

function dedupeByTacaItemId(
  products: ProductWithCategory[],
): ProductWithCategory[] {
  const map = new Map<number, ProductWithCategory>();
  for (const product of products) {
    // 용어: 옵션 단위 식별자는 tacaItemId (tacaId와 혼동 금지)
    if (!map.has(product.tacaItemId)) {
      map.set(product.tacaItemId, product);
    }
  }
  return [...map.values()];
}

/**
 * tacaItemId 기준 중복 제거 후,
 * 아기 키워드 상품을 앞에 두고 목표 개수만큼 반환합니다.
 */
function buildDiverseProductList(
  products: ProductWithCategory[],
): TossProduct[] {
  const unique = dedupeByTacaItemId(products);

  const priority: ProductWithCategory[] = [];
  const others: ProductWithCategory[] = [];

  for (const product of unique) {
    if (isPriorityProduct(product, product.categoryName)) {
      priority.push(product);
    } else {
      others.push(product);
    }
  }

  const merged = [...priority, ...others];
  // 화면 로딩/모바일 렌더를 위해 상한 적용 (목표 100개)
  return merged.slice(0, TARGET_PRODUCT_COUNT);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
  delayMs = CATEGORY_FETCH_DELAY_MS,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
      // 다음 카테고리 호출 전 짧은 딜레이로 429 완화
      if (index < items.length && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * size/limit 파라미터로 페이지를 요청하고,
 * fetchAll이면 hasNext가 끝날 때까지 전체 상품을 수집합니다.
 */
async function fetchProductsFill(
  path: string,
  accessToken: string,
  options?: {
    pageSize?: number;
    minCount?: number;
    fetchAll?: boolean;
    maxPages?: number;
  },
): Promise<TossProduct[]> {
  const pageSize = options?.pageSize ?? PRODUCT_FETCH_SIZE;
  const minCount = options?.minCount ?? UI_PAGE_SIZE;
  const fetchAll = options?.fetchAll ?? false;
  const maxPages = options?.maxPages ?? (fetchAll ? 20 : 1);

  const items: TossProduct[] = [];
  let cursor: string | null = null;
  let hasNext = true;
  let page = 0;

  while (hasNext && page < maxPages && (fetchAll || items.length < minCount)) {
    const separator = path.includes("?") ? "&" : "?";
    const query = new URLSearchParams({
      size: String(pageSize),
      limit: String(pageSize),
    });
    if (cursor) query.set("cursor", cursor);

    const result = await tossFetch<ProductListResult>(
      `${path}${separator}${query.toString()}`,
      accessToken,
    );

    items.push(...(result.items ?? []));
    hasNext = Boolean(result.hasNext);
    cursor = result.nextCursor;
    page += 1;

    if (!hasNext || !cursor) break;
    // 페이지 연속 호출 시 rate limit 완화
    if (PAGE_FETCH_DELAY_MS > 0) {
      await sleep(PAGE_FETCH_DELAY_MS);
    }
  }

  return fetchAll ? items : items.slice(0, Math.max(minCount, items.length));
}

async function fetchAllTodayDeals(
  accessToken: string,
): Promise<TossProduct[]> {
  return fetchProductsFill("/products/today-deals", accessToken, {
    pageSize: TODAY_DEALS_PAGE_SIZE,
    fetchAll: true,
  });
}

/** 육아/아기 관련 모든 카테고리에서 상품을 모아 50~100개 이상 확보합니다. */
async function fetchDiverseBestProducts(
  accessToken: string,
  categories: TossCategory[],
): Promise<{ products: TossProduct[]; categoryIds: number[] }> {
  const babyCategories = findBabyCategories(categories).slice(
    0,
    MAX_BABY_CATEGORY_FETCHES,
  );

  const envCategoryId = process.env.TOSS_BABY_CATEGORY_ID
    ? Number(process.env.TOSS_BABY_CATEGORY_ID)
    : null;

  if (
    envCategoryId &&
    !Number.isNaN(envCategoryId) &&
    !babyCategories.some((item) => item.categoryId === envCategoryId)
  ) {
    babyCategories.unshift({
      categoryId: envCategoryId,
      displayName: "env",
      level: 1,
      priority: -1,
    });
  }

  const collected: ProductWithCategory[] = [];

  async function fetchCategoryProducts(category: MatchedCategory) {
    try {
      const items = await fetchProductsFill(
        `/products/best-categories/${category.categoryId}`,
        accessToken,
        {
          pageSize: PRODUCT_FETCH_SIZE,
          minCount: TARGET_PRODUCT_COUNT,
          maxPages: MAX_PAGES_PER_CATEGORY,
        },
      );

      return items.map((item) => ({
        ...item,
        categoryName: category.displayName,
      }));
    } catch (error) {
      console.warn(
        `[/api/toss] 카테고리 베스트 실패: ${category.displayName}(${category.categoryId})`,
        error,
      );
      return [] as ProductWithCategory[];
    }
  }

  // 매핑된 모든 아기 카테고리 ID에 대해 상품 목록 요청 (동시성 제한)
  const babyResults = await mapWithConcurrency(
    babyCategories,
    CATEGORY_FETCH_CONCURRENCY,
    fetchCategoryProducts,
  );
  for (const items of babyResults) {
    collected.push(...items);
  }

  let uniqueCount = dedupeByTacaItemId(collected).length;

  // 50개 미만이면 보완 카테고리(가전/생활/식품/패션)에서 아기 키워드 상품만 추가
  if (uniqueCount < MIN_PRODUCT_COUNT) {
    const fallbackCategories = findFallbackCategories(categories).slice(0, 6);
    const fallbackResults = await mapWithConcurrency(
      fallbackCategories,
      CATEGORY_FETCH_CONCURRENCY,
      fetchCategoryProducts,
    );

    for (const items of fallbackResults) {
      for (const item of items) {
        if (isPriorityProduct(item, item.categoryName)) {
          collected.push(item);
        }
      }
    }
    uniqueCount = dedupeByTacaItemId(collected).length;
  }

  // 그래도 부족하면 전체 베스트에서 아기 키워드 상품으로 보완
  if (uniqueCount < TARGET_PRODUCT_COUNT) {
    try {
      const bestSelling = await fetchProductsFill(
        "/products/best-selling",
        accessToken,
        {
          pageSize: PRODUCT_FETCH_SIZE,
          minCount: TARGET_PRODUCT_COUNT,
          maxPages: MAX_PAGES_PER_CATEGORY,
        },
      );

      for (const item of bestSelling) {
        if (isPriorityProduct(item) || uniqueCount < MIN_PRODUCT_COUNT) {
          collected.push(item);
        }
      }
    } catch (error) {
      console.warn("[/api/toss] 전체 베스트 조회 실패", error);
    }
  }

  let products = buildDiverseProductList(collected);

  // 최종 안전망: 최소 개수 미달이면 중복 제거분만 최대한 반환
  if (products.length < MIN_PRODUCT_COUNT) {
    products = dedupeByTacaItemId(collected).slice(0, TARGET_PRODUCT_COUNT);
  }

  return {
    products,
    categoryIds: babyCategories.map((item) => item.categoryId),
  };
}

function normalizeProduct(product: TossProduct) {
  return {
    /** 상품 옵션 ID — 링크 발급에 사용 */
    tacaItemId: product.tacaItemId,
    displayName: product.displayName,
    brandName: product.brandName || "",
    thumbnailUrl: product.thumbnailUrl,
    /**
     * 일반 상품 URL — 수익 집계 안 됨.
     * 화면 표시/참고용이며 클릭 이동에는 shortUrl/originUrl만 사용.
     */
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

export const dynamic = "force-dynamic";

type BestPayload = {
  success: true;
  categoryIds: number[];
  categoryCount: number;
  count: number;
  products: ReturnType<typeof normalizeProduct>[];
};

type DailyPayload = {
  success: true;
  count: number;
  products: ReturnType<typeof normalizeProduct>[];
};

async function getCategoriesCached(
  accessToken: string,
): Promise<TossCategory[]> {
  const { data } = await getOrFetchCached(
    "toss:categories",
    CATEGORY_CACHE_TTL_MS,
    async () => {
      const result = await tossFetch<{ categories: TossCategory[] }>(
        "/categories",
        accessToken,
      );
      return result.categories ?? [];
    },
  );
  return data;
}

/** 하루특가: endAt이 지난 상품은 캐시에서도 제외 (규약) */
function filterActiveTodayDeals(products: TossProduct[]): TossProduct[] {
  const now = Date.now();
  return products.filter((product) => {
    if (!product.endAt) return true;
    const end = Date.parse(product.endAt);
    if (Number.isNaN(end)) return true;
    return end > now;
  });
}

async function buildBestPayload(): Promise<BestPayload> {
  const accessToken = await getAccessToken();
  // 연결 확인은 캐시 미스 시에만 (카테고리·상품 조회에 포함되는 호출 절약)
  await tossFetch<{ status: string }>("/health", accessToken);

  const categories = await getCategoriesCached(accessToken);
  const { products, categoryIds } = await fetchDiverseBestProducts(
    accessToken,
    categories,
  );

  return {
    success: true,
    categoryIds,
    categoryCount: categoryIds.length,
    count: products.length,
    products: products.map(normalizeProduct),
  };
}

async function buildDailyPayload(): Promise<DailyPayload> {
  const accessToken = await getAccessToken();
  await tossFetch<{ status: string }>("/health", accessToken);

  const allDeals = filterActiveTodayDeals(
    await fetchAllTodayDeals(accessToken),
  );
  const priorityDeals = allDeals.filter((item) => isPriorityProduct(item));
  const babyDeals = buildDiverseProductList([
    ...priorityDeals,
    ...allDeals,
  ]);

  return {
    success: true,
    count: babyDeals.length,
    products: babyDeals.map(normalizeProduct),
  };
}

export async function GET(request: NextRequest) {
  const type =
    request.nextUrl.searchParams.get("type") === "daily" ? "daily" : "best";
  const cacheKey = `toss:products:${type}`;
  const ttlMs = type === "daily" ? DAILY_CACHE_TTL_MS : BEST_CACHE_TTL_MS;

  try {
    const { data, cached } = await getOrFetchCached(
      cacheKey,
      ttlMs,
      type === "daily" ? buildDailyPayload : buildBestPayload,
    );

    // daily 캐시 HIT여도 endAt 지난 상품은 응답 전에 한 번 더 걸러냄
    if (type === "daily") {
      const active = data.products.filter((product) => {
        if (!product.endAt) return true;
        const end = Date.parse(product.endAt);
        return Number.isNaN(end) || end > Date.now();
      });

      return NextResponse.json(
        {
          ...data,
          products: active,
          count: active.length,
          cached,
        },
        {
          headers: {
            "Cache-Control": `public, s-maxage=${Math.floor(ttlMs / 1000)}, stale-while-revalidate=60`,
            "X-Cache": cached ? "HIT" : "MISS",
          },
        },
      );
    }

    return NextResponse.json(
      { ...data, cached },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${Math.floor(ttlMs / 1000)}, stale-while-revalidate=300`,
          "X-Cache": cached ? "HIT" : "MISS",
        },
      },
    );
  } catch (error) {
    console.error("[/api/toss]", error);
    // QUOTA_EXCEEDED 등은 재시도하지 않고 토스 에러 JSON 그대로 반환
    if (
      error instanceof TossApiError &&
      error.errorCode === "SHARELINK_OPENAPI_QUOTA_EXCEEDED"
    ) {
      console.warn("[/api/toss] 일 사용 상한 초과 — 재시도하지 않습니다.");
    }
    return tossErrorResponse(error);
  }
}
