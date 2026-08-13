"use client";

import { useEffect, useState } from "react";
import { openExternalUrl } from "@/lib/apps-in-toss";
import { apiUrl } from "@/lib/api-base";
import type { Product } from "@/types/product";

export type ProductDetail = Product & {
  tacaId?: number;
  mainImageUrls?: string[];
  description?: {
    detailImageUrls?: string[];
    noticeImageUrl?: string | null;
    htmlUrl?: string | null;
  };
};

type DetailApiResponse = {
  success?: boolean;
  product?: ProductDetail;
  fallbackRequired?: boolean;
  notFound?: boolean;
  cached?: boolean;
  stale?: boolean;
  fallback?: boolean;
  error?: string;
};

const clientDetailMemo = new Map<number, DetailApiResponse>();
const clientDetailInflight = new Map<number, Promise<DetailApiResponse>>();

function formatPrice(price: number) {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function formatReviewCount(count: number) {
  if (count >= 10_000) {
    return `${(count / 10_000).toFixed(1).replace(/\.0$/, "")}만`;
  }
  return new Intl.NumberFormat("ko-KR").format(count);
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** /api/toss/link 응답에서 추적 가능한 쉐어링크만 추출 (productUrl 절대 사용 금지) */
function extractShareUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const nested =
    obj.success && typeof obj.success === "object"
      ? (obj.success as Record<string, unknown>)
      : null;

  for (const key of ["shortUrl", "shareUrl", "originUrl"] as const) {
    const direct = obj[key];
    if (typeof direct === "string" && direct.startsWith("http")) return direct;
    const fromNested = nested?.[key];
    if (typeof fromNested === "string" && fromNested.startsWith("http")) {
      return fromNested;
    }
  }
  return null;
}

function extractLinkError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as {
    error?: string | { reason?: string; message?: string; errorCode?: string };
    reason?: string;
    message?: string;
  };
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
  if (obj.error && typeof obj.error === "object") {
    return (
      obj.error.reason ||
      obj.error.message ||
      obj.error.errorCode ||
      fallback
    );
  }
  if (typeof obj.reason === "string" && obj.reason.trim()) return obj.reason;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  return fallback;
}

/** /api/toss/detail/[id] 만 호출 — 토스 직접 fetch 금지. 세션 메모로 중복 호출 차단 */
async function loadDetailMemoized(tacaItemId: number): Promise<DetailApiResponse> {
  const memo = clientDetailMemo.get(tacaItemId);
  if (memo) return memo;

  const inflight = clientDetailInflight.get(tacaItemId);
  if (inflight) return inflight;

  const promise = (async () => {
    const response = await fetch(apiUrl(`/api/toss/detail/${tacaItemId}`));
    const data = (await readJsonSafe(response)) as DetailApiResponse | null;
    const normalized: DetailApiResponse = data ?? {
      success: false,
      fallbackRequired: true,
    };
    // 성공·notFound·fallbackRequired 모두 메모 (빈/실패도 재호출 폭주 방지)
    clientDetailMemo.set(tacaItemId, normalized);
    return normalized;
  })().finally(() => {
    clientDetailInflight.delete(tacaItemId);
  });

  clientDetailInflight.set(tacaItemId, promise);
  return promise;
}

function mergeDetail(listProduct: Product, detail?: ProductDetail | null): ProductDetail {
  if (!detail) return { ...listProduct, mainImageUrls: [listProduct.thumbnailUrl] };
  return {
    ...listProduct,
    ...detail,
    // 상세 실패 시에도 목록 기본 정보는 유지
    displayName: detail.displayName || listProduct.displayName,
    thumbnailUrl: detail.thumbnailUrl || listProduct.thumbnailUrl,
    productUrl: detail.productUrl || listProduct.productUrl,
    displayPrice: detail.displayPrice ?? listProduct.displayPrice,
    originalPrice: detail.originalPrice ?? listProduct.originalPrice,
    discountRate: detail.discountRate ?? listProduct.discountRate,
    reviewScore: detail.reviewScore ?? listProduct.reviewScore,
    reviewCount: detail.reviewCount ?? listProduct.reviewCount,
    mainImageUrls:
      detail.mainImageUrls?.length
        ? detail.mainImageUrls
        : [detail.thumbnailUrl || listProduct.thumbnailUrl],
  };
}

type Props = {
  listProduct: Product;
  onClose: () => void;
};

export default function ProductDetailSheet({ listProduct, onClose }: Props) {
  const [product, setProduct] = useState<ProductDetail>(() =>
    mergeDetail(listProduct),
  );
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUsingFallback(false);
    setImageIndex(0);
    setProduct(mergeDetail(listProduct));

    void loadDetailMemoized(listProduct.tacaItemId)
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.product) {
          setProduct(mergeDetail(listProduct, data.product));
          setUsingFallback(Boolean(data.stale || data.fallback));
        } else {
          // 에러/notFound — 목록 기본 정보로 UI 유지 (에러 페이지 없음)
          setProduct(mergeDetail(listProduct));
          setUsingFallback(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProduct(mergeDetail(listProduct));
        setUsingFallback(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listProduct]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const images =
    product.mainImageUrls?.filter(Boolean).length
      ? product.mainImageUrls.filter(Boolean)
      : [product.thumbnailUrl];
  const detailImages = product.description?.detailImageUrls ?? [];

  async function handleBuy() {
    if (linking) return;
    const tacaItemId = product.tacaItemId;
    if (!tacaItemId) {
      setLinkError("상품 ID가 없어 쉐어링크를 발급할 수 없어요.");
      return;
    }

    // 팝업 차단 대비 — 제스처 직후 빈 창을 연 뒤 발급 URL로 이동
    const newWindow = window.open(
      "about:blank",
      "_blank",
      "noopener,noreferrer",
    );
    setLinking(true);
    setLinkError(null);

    try {
      // productUrl 은 추적·수익 집계가 안 됨 → tacaItemId 로 쉐어링크만 발급
      const response = await fetch(apiUrl("/api/toss/link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tacaItemId }),
      });
      const data = await readJsonSafe(response);
      const shareUrl = extractShareUrl(data);

      if (!response.ok || !shareUrl) {
        throw new Error(
          extractLinkError(data, "쉐어링크 발급에 실패했습니다."),
        );
      }

      if (newWindow && !newWindow.closed) {
        try {
          newWindow.location.href = shareUrl;
          return;
        } catch {
          // ignore — openExternalUrl 로 재시도
        }
      }
      await openExternalUrl(shareUrl);
    } catch (error) {
      try {
        newWindow?.close();
      } catch {
        // ignore
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : "구매 링크를 열지 못했어요. 잠시 후 다시 시도해 주세요.";
      setLinkError(message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="상품 상세"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />

      <div className="relative z-[1] flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl animate-[fadeUp_0.25s_ease-out]">
        <div className="flex items-center justify-between border-b border-[#f2f4f6] px-4 py-3">
          <p className="text-[15px] font-bold text-[#191f28]">상품 상세</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#f2f4f6] px-3 py-1.5 text-[13px] font-semibold text-[#4e5968]"
          >
            닫기
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-28 pt-3">
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-[#f2f4f6]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[imageIndex] || product.thumbnailUrl}
              alt={product.displayName}
              className="h-full w-full object-cover"
            />
            {loading && (
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px]" />
            )}
            {product.discountRate > 0 && (
              <span className="absolute left-3 top-3 rounded-xl bg-[#f04452] px-2.5 py-1 text-[16px] font-extrabold text-white tabular-nums">
                {product.discountRate}%
              </span>
            )}
          </div>

          {images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto scrollbar-hide">
              {images.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-2 ${
                    i === imageIndex ? "ring-[#3182f6]" : "ring-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4">
            {product.brandName ? (
              <p className="text-[12px] font-medium text-[#8b95a1]">
                {product.brandName}
              </p>
            ) : null}
            <h2 className="mt-1 text-[18px] font-bold leading-snug tracking-[-0.02em] text-[#191f28]">
              {product.displayName}
            </h2>

            <div className="mt-3 flex flex-wrap items-baseline gap-2">
              {product.discountRate > 0 && (
                <span className="text-[20px] font-extrabold text-[#f04452] tabular-nums">
                  {product.discountRate}%
                </span>
              )}
              <span className="text-[22px] font-extrabold tabular-nums text-[#191f28]">
                {formatPrice(product.displayPrice)}
                <span className="ml-0.5 text-[14px] font-bold">원</span>
              </span>
              {product.originalPrice > product.displayPrice && (
                <span className="text-[14px] text-[#b0b8c1] line-through tabular-nums">
                  {formatPrice(product.originalPrice)}원
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[#4e5968]">
              {(product.reviewScore ?? 0) > 0 || (product.reviewCount ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold">
                  <span className="text-[#f04452]">★</span>
                  <span className="tabular-nums text-[#191f28]">
                    {(product.reviewScore ?? 0).toFixed(1)}
                  </span>
                  {(product.reviewCount ?? 0) > 0 && (
                    <span className="font-normal text-[#8b95a1]">
                      후기 {formatReviewCount(product.reviewCount ?? 0)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[#b0b8c1]">후기 없음</span>
              )}
              <span className="rounded-md bg-[#f2f4f6] px-1.5 py-0.5 text-[11px] font-semibold">
                토스배송
              </span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                  product.isSoldOut
                    ? "bg-[#fff1f0] text-[#f04452]"
                    : "bg-[#e8f3ff] text-[#3182f6]"
                }`}
              >
                {product.isSoldOut ? "품절" : "판매중"}
              </span>
            </div>

            {usingFallback && (
              <p className="mt-3 rounded-xl bg-[#f2f4f6] px-3 py-2 text-[12px] text-[#6b7684]">
                상세 정보를 불러오지 못해 목록 정보로 보여드려요.
              </p>
            )}
          </div>

          {detailImages.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[14px] font-bold text-[#191f28]">상세 이미지</p>
              <div className="flex flex-col gap-2">
                {detailImages.slice(0, 8).map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${url}-${i}`}
                    src={url}
                    alt=""
                    className="w-full rounded-xl bg-[#f2f4f6]"
                    loading="lazy"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-[#f2f4f6] bg-white/95 px-4 py-3 backdrop-blur-sm">
          {linkError && (
            <p className="mb-2 text-center text-[12px] text-[#f04452]">{linkError}</p>
          )}
          <button
            type="button"
            disabled={linking || product.isSoldOut}
            onClick={() => void handleBuy()}
            className="w-full rounded-2xl bg-[#3182f6] py-3.5 text-[15px] font-bold text-white transition active:scale-[0.99] disabled:bg-[#b0b8c1]"
          >
            {product.isSoldOut
              ? "품절된 상품이에요"
              : linking
                ? "쉐어링크 발급 중…"
                : "구매하러 가기"}
          </button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-[#8b95a1]">
            이 서비스는 토스쇼핑 제휴 활동의 일환으로, 구매 시 일정액의 수수료를
            제공받을 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
