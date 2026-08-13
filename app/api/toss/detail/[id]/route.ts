import { NextRequest, NextResponse } from "next/server";
import {
  fetchProductDetailById,
  getAccessToken,
  TossApiError,
  type TossProductDetail,
} from "@/lib/toss-api";

/** 상품 ID(tacaItemId) 단위 1시간 캐시 */
const CACHE_TTL_MS = 3600_000;
const MAX_CACHE_SIZE = 500;
const CACHE_VERSION = "v1-product-detail";

type CacheEntry = {
  expiresAt: number;
  body: Record<string, unknown>;
};

const responseCache = new Map<string, CacheEntry>();
const lastSuccessCache = new Map<string, Record<string, unknown>>();
const inflightByKey = new Map<string, Promise<Record<string, unknown>>>();

function cacheKey(tacaItemId: number) {
  return `toss:detail:${CACHE_VERSION}:${tacaItemId}`;
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now > entry.expiresAt) responseCache.delete(key);
  }
}

function evictLru() {
  while (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
}

function getFresh(key: string): Record<string, unknown> | null {
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

function setSuccess(key: string, body: Record<string, unknown>) {
  pruneExpired();
  if (responseCache.has(key)) responseCache.delete(key);
  evictLru();
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body });
  lastSuccessCache.set(key, body);
}

function normalizeDetail(detail: TossProductDetail) {
  return {
    tacaItemId: detail.tacaItemId,
    tacaId: detail.tacaId,
    displayName: detail.displayName,
    brandName: detail.brandName || "",
    thumbnailUrl: detail.thumbnailUrl,
    mainImageUrls: detail.mainImageUrls ?? [],
    productUrl: detail.productUrl,
    displayPrice: detail.displayPrice,
    originalPrice: detail.originalPrice,
    discountRate: detail.discountRate,
    isSoldOut: detail.isSoldOut,
    reviewScore: detail.reviewScore ?? 0,
    reviewCount: detail.reviewCount ?? 0,
    description: {
      detailImageUrls: detail.description?.detailImageUrls ?? [],
      noticeImageUrl: detail.description?.noticeImageUrl ?? null,
      htmlUrl: detail.description?.htmlUrl ?? null,
    },
  };
}

/**
 * GET /api/toss/detail/[id]
 * id = tacaItemId
 *
 * - 클라이언트는 토스 상세 API를 직접 호출하지 않음
 * - tacaItemId 단위 1시간 메모리 캐시 + fetch revalidate
 * - 429/에러 시 lastSuccess 폴백 (없으면 fallbackRequired로 목록 UI 유지 유도)
 *
 * @see https://sharelink-docs.toss.im/guide/open-api/api/product-detail
 */
export const revalidate = 3600;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(context.params);
  const tacaItemId = Number(params.id);

  if (!Number.isFinite(tacaItemId) || tacaItemId <= 0) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: "유효한 tacaItemId가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const key = cacheKey(tacaItemId);

  const fresh = getFresh(key);
  if (fresh) {
    return NextResponse.json({ ...fresh, cached: true, stale: false });
  }

  const existing = inflightByKey.get(key);
  if (existing) {
    const body = await existing;
    return NextResponse.json({ ...body, cached: true, stale: Boolean(body.stale) });
  }

  const promise = (async (): Promise<Record<string, unknown>> => {
    try {
      const accessToken = await getAccessToken();
      const detail = await fetchProductDetailById(accessToken, tacaItemId);

      // notFound — 재시도해도 동일. 캐시해 할당량 보호
      if (!detail) {
        const body = {
          success: false as const,
          notFound: true,
          fallbackRequired: true,
          tacaItemId,
          error: "상품 상세를 찾을 수 없습니다.",
        };
        setSuccess(key, body);
        return body;
      }

      const body = {
        success: true as const,
        tacaItemId,
        product: normalizeDetail(detail),
        empty: false,
      };
      setSuccess(key, body);
      return body;
    } catch (error) {
      const fallback = getLastSuccess(key);
      if (fallback) {
        console.warn("[/api/toss/detail] upstream failed — lastSuccess", {
          tacaItemId,
          status: error instanceof TossApiError ? error.status : undefined,
        });
        return {
          ...fallback,
          stale: true,
          fallback: true,
          success: fallback.success !== false,
        };
      }

      // 캐시 없음 — 에러 페이지 대신 목록 폴백 유도 (HTTP 200)
      console.error("[/api/toss/detail]", error);
      return {
        success: false,
        fallbackRequired: true,
        tacaItemId,
        error:
          error instanceof TossApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "상세 조회 실패",
        status: error instanceof TossApiError ? error.status : 500,
      };
    } finally {
      inflightByKey.delete(key);
    }
  })();

  inflightByKey.set(key, promise);
  const body = await promise;

  return NextResponse.json({
    ...body,
    cached: Boolean(body.fallback) || Boolean(body.stale),
    stale: Boolean(body.stale),
    cacheTtlSec: 3600,
    cacheKey: key,
  });
}
