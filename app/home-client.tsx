"use client";

import { useEffect, useState } from "react";
import BottomBannerAd from "@/components/BottomBannerAd";
import {
  ensureAnonymousUserKey,
  openExternalUrl,
} from "@/lib/apps-in-toss";

export type Product = {
  /** 상품 옵션 식별자 — 링크 발급에 사용 (tacaId와 다름) */
  tacaItemId: number;
  displayName: string;
  thumbnailUrl: string;
  /** 일반 상품 URL — 수익 미집계, 클릭 이동에 사용하지 않음 */
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  brandName?: string;
  endAt?: string;
  rank?: number;
  reviewScore?: number;
  reviewCount?: number;
  salesCount?: number;
  viewCount?: number;
  commentCount?: number;
  createdAt?: string;
};

type ApiResponse = {
  success?: boolean;
  products?: Product[];
  error?: string | { errorCode?: string; reason?: string } | null;
  resultType?: string;
  message?: string;
};

const PAGE_SIZE = 20;

function formatPrice(price: number) {
  return new Intl.NumberFormat("ko-KR").format(price);
}

/** API 에러 본문에서 메시지를 안전하게 추출합니다. (null.error 접근 방지) */
function getApiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const obj = data as Record<string, unknown>;
  const err = obj.error;

  if (typeof err === "string" && err.trim()) {
    return err;
  }

  if (err && typeof err === "object") {
    const detail = err as {
      reason?: string;
      errorCode?: string;
      message?: string;
    };
    return (
      detail.reason ||
      detail.message ||
      detail.errorCode ||
      fallback
    );
  }

  if (typeof obj.message === "string" && obj.message.trim()) {
    return obj.message;
  }

  if (typeof obj.reason === "string" && obj.reason.trim()) {
    return obj.reason;
  }

  return fallback;
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function ProductCard({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function handleOpenShareLink() {
    if (linking) return;

    // 용어: 링크 발급은 반드시 tacaItemId (옵션 단위)
    const tacaItemId = product.tacaItemId;
    if (!tacaItemId) {
      setLinkError("상품 옵션 ID(tacaItemId)가 없습니다.");
      return;
    }

    setLinking(true);
    setLinkError(null);
    try {
      const response = await fetch("/api/toss/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tacaItemId }),
      });
      const data = (await readJsonSafe(response)) as {
        success?:
          | boolean
          | {
              shortUrl?: string;
              originUrl?: string;
              shareUrl?: string;
            };
        shareUrl?: string;
        shortUrl?: string;
        originUrl?: string;
        error?: string | { reason?: string } | null;
        resultType?: string;
      } | null;

      if (
        !response.ok ||
        !data ||
        data.resultType === "FAIL" ||
        data.success === false
      ) {
        throw new Error(
          getApiErrorMessage(data, "쉐어링크 발급에 실패했습니다."),
        );
      }

      const nested =
        data.success && typeof data.success === "object"
          ? data.success
          : null;

      // 수익 집계되는 shortUrl / originUrl 만 사용 (productUrl 사용 금지)
      const shareUrl =
        data.shareUrl ||
        data.shortUrl ||
        data.originUrl ||
        nested?.shareUrl ||
        nested?.shortUrl ||
        nested?.originUrl;

      if (!shareUrl) {
        throw new Error("추적 링크(shortUrl)를 받지 못했습니다.");
      }

      await openExternalUrl(shareUrl);
    } catch (error) {
      console.error(error);
      // productUrl로 폴백하지 않음 — 수익이 집계되지 않음
      const message =
        error instanceof Error
          ? error.message
          : "쉐어링크 발급에 실패했습니다.";
      setLinkError(message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-busy={linking}
      aria-label={`${product.displayName} 구매하러 가기`}
      onClick={() => void handleOpenShareLink()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleOpenShareLink();
        }
      }}
      className={`baby-card group relative flex w-full cursor-pointer flex-col overflow-hidden ${
        linking ? "opacity-80" : ""
      }`}
    >
      {linking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-baby-card/70 backdrop-blur-[1px]">
          <span className="rounded-full bg-baby-card px-3 py-1.5 text-[11px] font-bold text-baby-ink shadow-baby-sm ring-1 ring-baby-butter">
            링크 발급 중…
          </span>
        </div>
      )}

      <div
        className={`relative overflow-hidden bg-gradient-to-br from-baby-butter/40 to-baby-border/50 ${
          compact ? "aspect-square" : "aspect-[4/5]"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.thumbnailUrl}
          alt={product.displayName}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
          draggable={false}
        />
        {product.discountRate > 0 && (
          <span className="absolute left-2 top-2 rounded-lg bg-baby-butter px-2 py-1 text-xs font-bold text-baby-ink shadow-baby-sm ring-1 ring-baby-border">
            {product.discountRate}%
          </span>
        )}
        {product.isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-baby-ink/40">
            <span className="rounded-full bg-baby-card/95 px-3 py-1 text-xs font-semibold text-baby-ink">
              품절
            </span>
          </div>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${compact ? "p-2.5" : "p-3"}`}>
        {product.brandName && (
          <p className="mb-0.5 truncate text-[11px] font-medium text-baby-cta">
            {product.brandName}
          </p>
        )}
        <h3
          className={`line-clamp-2 font-semibold text-baby-ink ${
            compact
              ? "min-h-[2.4em] text-xs leading-snug"
              : "min-h-[2.6em] text-sm leading-snug"
          }`}
        >
          {product.displayName}
        </h3>

        <div className="mt-2 flex items-baseline gap-1.5">
          {product.discountRate > 0 && (
            <span className="text-sm font-extrabold text-baby-cta">
              {product.discountRate}%
            </span>
          )}
          <span
            className={`font-extrabold tracking-tight text-baby-ink ${
              compact ? "text-sm" : "text-base"
            }`}
          >
            {formatPrice(product.displayPrice)}
            <span className="ml-0.5 text-xs font-semibold">원</span>
          </span>
        </div>
        {product.originalPrice > product.displayPrice && (
          <p className="mt-0.5 text-[11px] text-baby-mute line-through">
            {formatPrice(product.originalPrice)}원
          </p>
        )}

        <button
          type="button"
          disabled={linking}
          onClick={(event) => {
            event.stopPropagation();
            void handleOpenShareLink();
          }}
          className={`mt-auto w-full rounded-xl bg-baby-cta font-bold text-white shadow-baby-sm transition hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
            compact ? "mt-2.5 py-2 text-[11px]" : "mt-3 py-2.5 text-xs"
          }`}
        >
          {linking ? "발급 중…" : "구매하러 가기"}
        </button>
        {linkError && (
          <p className="mt-1.5 text-[10px] leading-snug text-baby-cta">
            {linkError}
          </p>
        )}
      </div>
    </article>
  );
}

function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`baby-card animate-pulse overflow-hidden ${
        compact ? "h-full w-full" : ""
      }`}
    >
      <div
        className={`bg-baby-border/60 ${compact ? "aspect-square" : "aspect-[4/5]"}`}
      />
      <div className="space-y-2 p-3">
        <div className="h-3 rounded bg-baby-border/80" />
        <div className="h-3 w-2/3 rounded bg-baby-border/70" />
        <div className="h-8 rounded-xl bg-baby-butter/70" />
      </div>
    </div>
  );
}

function DailyDealCarousel({
  products,
  loading,
}: {
  products: Product[];
  loading: boolean;
}) {
  return (
    <div className="relative -mx-4">
      <div
        className="daily-carousel px-4"
        role="region"
        aria-label="오늘의 아기용품 하루특가 캐러셀"
      >
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="daily-carousel-item">
                <SkeletonCard compact />
              </div>
            ))
          : products.map((product, index) => (
              <div
                key={`daily-${product.tacaItemId || index}`}
                className="daily-carousel-item"
              >
                <ProductCard product={product} compact />
              </div>
            ))}
        {/* 끝 여백: 마지막 카드가 화면 가장자리에 붙지 않도록 */}
        <div className="w-1 shrink-0 snap-none" aria-hidden />
      </div>
    </div>
  );
}

export default function HomeClient() {
  const [bestItems, setBestItems] = useState<Product[]>([]);
  const [dailyItems, setDailyItems] = useState<Product[]>([]);
  const [bestLoading, setBestLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [bestError, setBestError] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    void ensureAnonymousUserKey();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load(type: "best" | "daily") {
      try {
        const response = await fetch(`/api/toss?type=${type}`);
        const data = (await readJsonSafe(response)) as ApiResponse | null;
        const products = Array.isArray(data?.products) ? data.products : null;

        // 상품 배열이 있으면 성공으로 처리 (정렬 탭과 무관)
        if (response.ok && products) {
          if (cancelled) return;
          if (type === "best") {
            setBestItems(products);
            setBestError(null);
          } else {
            setDailyItems(products);
            setDailyError(null);
          }
          return;
        }

        if (
          !response.ok ||
          !data ||
          data.success === false ||
          data.resultType === "FAIL"
        ) {
          throw new Error(
            getApiErrorMessage(data, "상품을 불러오지 못했습니다."),
          );
        }

        if (cancelled) return;

        if (type === "best") {
          setBestItems([]);
        } else {
          setDailyItems([]);
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "오류가 발생했습니다.";
        if (type === "best") setBestError(message);
        else setDailyError(message);
      } finally {
        if (cancelled) return;
        if (type === "best") setBestLoading(false);
        else setDailyLoading(false);
      }
    }

    void load("best");
    void load("daily");

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleBestItems = bestItems.slice(0, visibleCount);
  const hasMore = visibleCount < bestItems.length;

  const hideDaily = !dailyLoading && !dailyError && dailyItems.length === 0;

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-baby-bg text-baby-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-warm-atmosphere"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 top-40 h-40 w-40 rounded-full bg-baby-butter opacity-40 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 top-24 h-32 w-32 rounded-full bg-baby-cta opacity-20 blur-2xl"
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-5">
        {/* 자체 뒤로가기 버튼 없음 — 토스 내비게이션 바만 사용 */}
        <header className="mb-5 animate-[fadeUp_0.5s_ease-out]">
          <p className="mb-1 text-xs font-semibold tracking-wide text-baby-cta">
            TOSS BABY PICKS
          </p>
          <h1 className="font-display text-[1.35rem] font-extrabold leading-snug tracking-tight text-baby-ink sm:text-2xl">
            아이특가 - 오늘의 추천 유아용품
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-baby-mute">
            토스쇼핑에서 엄선한 아기용품 베스트와 하루특가를 모았어요.
          </p>
        </header>

        <section
          className="mb-8 animate-[fadeUp_0.6s_ease-out]"
          style={{ display: hideDaily ? "none" : undefined }}
        >
          <div className="mb-3">
            <div>
              <div className="mb-1 inline-flex items-center rounded-md bg-baby-butter px-2 py-0.5 text-[10px] font-bold tracking-wide text-baby-ink shadow-baby-sm ring-1 ring-baby-border">
                하루특가
              </div>
              <h2 className="font-display text-lg font-bold text-baby-ink">
                오늘의 아기용품 하루특가
              </h2>
              <p className="text-xs text-baby-mute">
                오늘만 이 가격, 놓치지 마세요
              </p>
            </div>
          </div>

          {dailyError ? (
            <p className="baby-card px-4 py-6 text-center text-sm text-baby-mute">
              {dailyError}
            </p>
          ) : (
            <DailyDealCarousel products={dailyItems} loading={dailyLoading} />
          )}
        </section>

        <section className="mb-8 animate-[fadeUp_0.7s_ease-out]">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-baby-ink">
                아기용품 베스트
              </h2>
              <p className="text-xs text-baby-mute">
                출산·유아동 카테고리 인기 상품
              </p>
            </div>
          </div>

          {bestError ? (
            <p className="baby-card px-4 py-10 text-center text-sm text-baby-mute">
              {bestError}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {bestLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <SkeletonCard key={index} />
                    ))
                  : visibleBestItems.map((product, index) => (
                      <ProductCard
                        key={`best-${product.tacaItemId || index}`}
                        product={product}
                      />
                    ))}
              </div>

              {!bestLoading && hasMore && (
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((count) => count + PAGE_SIZE)
                  }
                  className="mt-5 w-full rounded-2xl border border-baby-border bg-baby-card py-3.5 text-sm font-bold text-baby-ink shadow-baby-sm transition hover:bg-baby-butter/50 hover:shadow-baby active:scale-[0.99]"
                >
                  더보기
                </button>
              )}
            </>
          )}
        </section>

        <footer className="mt-auto rounded-2xl border border-baby-border bg-baby-card/90 px-4 py-4 text-center shadow-baby-sm backdrop-blur-sm">
          <p className="text-[11px] leading-relaxed text-baby-mute">
            본 서비스는 토스쇼핑 쉐어링크 활동의 일환으로 일정 수수료를 제공받을 수
            있습니다.
          </p>
        </footer>
      </div>

      {/* 웹뷰 하단 배너만 — 전면/리워드 광고 미사용 */}
      <BottomBannerAd />
    </div>
  );
}
