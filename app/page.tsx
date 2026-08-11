"use client";

import { useEffect, useMemo, useState } from "react";

export type Product = {
  tacaItemId: number;
  productId?: number;
  displayName: string;
  thumbnailUrl: string;
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  shortUrl?: string;
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

type SortKey = "sales" | "newest" | "views" | "comments";

type ApiResponse = {
  success?: boolean;
  products?: Product[];
  error?: string | { errorCode?: string; reason?: string };
  resultType?: string;
};

const PAGE_SIZE = 20;

const SORT_TABS: { key: SortKey; label: string }[] = [
  { key: "sales", label: "판매순" },
  { key: "newest", label: "신상품순" },
  { key: "views", label: "조회순" },
  { key: "comments", label: "댓글순" },
];

function formatPrice(price: number) {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function openUrl(url?: string) {
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function sortProducts(products: Product[], sortKey: SortKey): Product[] {
  const list = [...products];

  switch (sortKey) {
    case "sales":
      return list.sort((a, b) => {
        const salesA = a.salesCount;
        const salesB = b.salesCount;
        if (salesA != null || salesB != null) {
          return (salesB ?? 0) - (salesA ?? 0);
        }
        if (a.rank != null || b.rank != null) {
          return (
            (a.rank ?? Number.MAX_SAFE_INTEGER) -
            (b.rank ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
      });
    case "newest":
      return list.sort((a, b) => {
        if (a.createdAt || b.createdAt) {
          return (
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime()
          );
        }
        return (b.tacaItemId ?? 0) - (a.tacaItemId ?? 0);
      });
    case "views":
      return list.sort((a, b) => {
        const viewsA = a.viewCount ?? a.reviewCount ?? 0;
        const viewsB = b.viewCount ?? b.reviewCount ?? 0;
        if (viewsB !== viewsA) return viewsB - viewsA;
        return (b.reviewScore ?? 0) - (a.reviewScore ?? 0);
      });
    case "comments":
      return list.sort((a, b) => {
        const commentsA = a.commentCount ?? a.reviewCount ?? 0;
        const commentsB = b.commentCount ?? b.reviewCount ?? 0;
        if (commentsB !== commentsA) return commentsB - commentsA;
        return (b.reviewScore ?? 0) - (a.reviewScore ?? 0);
      });
    default:
      return list;
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

  async function handleOpenShareLink() {
    if (linking) return;

    const productId = product.productId || product.tacaItemId;
    if (!productId) {
      openUrl(product.productUrl);
      return;
    }

    setLinking(true);
    try {
      const response = await fetch("/api/toss/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        shareUrl?: string;
        shortUrl?: string;
        error?: string | { reason?: string };
        resultType?: string;
      };

      if (
        !response.ok ||
        data.success === false ||
        data.resultType === "FAIL"
      ) {
        const message =
          typeof data.error === "object"
            ? data.error.reason
            : data.error;
        throw new Error(message || "쉐어링크 발급에 실패했습니다.");
      }

      const shareUrl = data.shareUrl || data.shortUrl;
      if (!shareUrl) {
        throw new Error("shareUrl이 비어 있습니다.");
      }

      openUrl(shareUrl);
    } catch (error) {
      console.error(error);
      // 발급 실패 시 일반 상품 URL로 폴백
      openUrl(product.productUrl);
    } finally {
      setLinking(false);
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-busy={linking}
      onClick={() => void handleOpenShareLink()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleOpenShareLink();
        }
      }}
      className={`group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-white/90 shadow-[0_8px_24px_rgba(255,160,180,0.12)] ring-1 ring-rose-100/80 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(255,140,170,0.2)] ${
        linking ? "opacity-80" : ""
      }`}
    >
      {linking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
          <span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-rose-500 shadow-sm ring-1 ring-rose-100">
            링크 발급 중…
          </span>
        </div>
      )}

      <div
        className={`relative overflow-hidden bg-gradient-to-br from-rose-50 to-sky-50 ${
          compact ? "aspect-square" : "aspect-[4/5]"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.thumbnailUrl}
          alt={product.displayName}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {product.discountRate > 0 && (
          <span className="absolute left-2 top-2 rounded-lg bg-[#FF6B8A] px-2 py-1 text-xs font-bold text-white shadow-sm">
            {product.discountRate}%
          </span>
        )}
        {product.isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700">
              품절
            </span>
          </div>
        )}
      </div>

      <div className={`flex flex-1 flex-col ${compact ? "p-2.5" : "p-3"}`}>
        {product.brandName && (
          <p className="mb-0.5 truncate text-[11px] font-medium text-rose-400">
            {product.brandName}
          </p>
        )}
        <h3
          className={`line-clamp-2 font-semibold text-slate-700 ${
            compact
              ? "min-h-[2.4em] text-xs leading-snug"
              : "min-h-[2.6em] text-sm leading-snug"
          }`}
        >
          {product.displayName}
        </h3>

        <div className="mt-2 flex items-baseline gap-1.5">
          {product.discountRate > 0 && (
            <span className="text-sm font-extrabold text-[#FF5A7A]">
              {product.discountRate}%
            </span>
          )}
          <span
            className={`font-extrabold tracking-tight text-slate-800 ${
              compact ? "text-sm" : "text-base"
            }`}
          >
            {formatPrice(product.displayPrice)}
            <span className="ml-0.5 text-xs font-semibold">원</span>
          </span>
        </div>
        {product.originalPrice > product.displayPrice && (
          <p className="mt-0.5 text-[11px] text-slate-400 line-through">
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
          className={`mt-auto w-full rounded-xl bg-gradient-to-r from-[#FF8FAB] to-[#FF6B8A] font-bold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
            compact ? "mt-2.5 py-2 text-[11px]" : "mt-3 py-2.5 text-xs"
          }`}
        >
          {linking ? "발급 중…" : "구매하러 가기"}
        </button>
      </div>
    </article>
  );
}

function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`animate-pulse overflow-hidden rounded-2xl bg-white/70 ring-1 ring-rose-100/60 ${
        compact ? "h-full w-full" : ""
      }`}
    >
      <div
        className={`bg-rose-50/80 ${compact ? "aspect-square" : "aspect-[4/5]"}`}
      />
      <div className="space-y-2 p-3">
        <div className="h-3 rounded bg-rose-50" />
        <div className="h-3 w-2/3 rounded bg-rose-50" />
        <div className="h-8 rounded-xl bg-rose-100/70" />
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

export default function Home() {
  const [bestItems, setBestItems] = useState<Product[]>([]);
  const [dailyItems, setDailyItems] = useState<Product[]>([]);
  const [bestLoading, setBestLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [bestError, setBestError] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;

    async function load(type: "best" | "daily") {
      try {
        const response = await fetch(`/api/toss?type=${type}`);
        const data = (await response.json()) as ApiResponse;

        if (
          !response.ok ||
          data.success === false ||
          data.resultType === "FAIL"
        ) {
          const tossError =
            typeof data.error === "object" && data.error
              ? data.error.reason || data.error.errorCode
              : data.error;
          throw new Error(tossError || "상품을 불러오지 못했습니다.");
        }

        if (cancelled) return;

        if (type === "best") {
          setBestItems(data.products ?? []);
        } else {
          setDailyItems(data.products ?? []);
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

  const sortedBestItems = useMemo(
    () => sortProducts(bestItems, sortKey),
    [bestItems, sortKey],
  );

  const visibleBestItems = sortedBestItems.slice(0, visibleCount);
  const hasMore = visibleCount < sortedBestItems.length;

  const hideDaily = !dailyLoading && !dailyError && dailyItems.length === 0;

  function handleSortChange(next: SortKey) {
    setSortKey(next);
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#FFF7FA] text-slate-800">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,_rgba(255,183,197,0.45),_transparent_60%),radial-gradient(ellipse_at_80%_20%,_rgba(186,230,253,0.5),_transparent_45%),linear-gradient(180deg,#FFF0F5_0%,#FFF7FA_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 top-40 h-40 w-40 rounded-full bg-mint-blob opacity-40 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 top-24 h-32 w-32 rounded-full bg-peach-blob opacity-50 blur-2xl"
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-5">
        <header className="mb-5 animate-[fadeUp_0.5s_ease-out]">
          <p className="mb-1 text-xs font-semibold tracking-wide text-rose-400">
            TOSS BABY PICKS
          </p>
          <h1 className="font-display text-[1.35rem] font-extrabold leading-snug tracking-tight text-slate-800 sm:text-2xl">
            👶 아이특가 - 오늘의 추천 유아용품
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            토스쇼핑에서 엄선한 아기용품 베스트와 하루특가를 모았어요.
          </p>
        </header>

        {/* 정렬 탭 */}
        <nav
          className="mb-6 animate-[fadeUp_0.55s_ease-out]"
          aria-label="상품 정렬"
        >
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-white/80 p-1.5 ring-1 ring-rose-100/80 shadow-[0_4px_16px_rgba(255,160,180,0.08)]">
            {SORT_TABS.map((tab) => {
              const active = sortKey === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleSortChange(tab.key)}
                  className={`rounded-xl px-1 py-2.5 text-center text-[12px] font-bold transition active:scale-[0.97] sm:text-sm ${
                    active
                      ? "bg-gradient-to-r from-[#FF8FAB] to-[#FF6B8A] text-white shadow-sm"
                      : "text-slate-500 hover:bg-rose-50 hover:text-rose-500"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <section
          className="mb-8 animate-[fadeUp_0.6s_ease-out]"
          style={{ display: hideDaily ? "none" : undefined }}
        >
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-800">
                오늘의 아기용품 하루특가
              </h2>
              <p className="text-xs text-slate-500">
                오늘만 이 가격, 놓치지 마세요
              </p>
            </div>
            {!dailyLoading && dailyItems.length > 0 && (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-600">
                {dailyItems.length}개
              </span>
            )}
          </div>

          {dailyError ? (
            <p className="rounded-2xl bg-white/80 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-rose-100">
              {dailyError}
            </p>
          ) : (
            <DailyDealCarousel products={dailyItems} loading={dailyLoading} />
          )}
        </section>

        <section className="mb-8 animate-[fadeUp_0.7s_ease-out]">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-800">
                아기용품 베스트
              </h2>
              <p className="text-xs text-slate-500">
                {bestLoading
                  ? "출산·유아동 인기 상품을 불러오는 중"
                  : `${sortedBestItems.length}개 중 ${visibleBestItems.length}개 표시`}
              </p>
            </div>
          </div>

          {bestError ? (
            <p className="rounded-2xl bg-white/80 px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-rose-100">
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
                        key={`best-${sortKey}-${product.tacaItemId || index}`}
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
                  className="mt-5 w-full rounded-2xl bg-white/90 py-3.5 text-sm font-bold text-rose-500 ring-1 ring-rose-200 transition hover:bg-rose-50 active:scale-[0.99]"
                >
                  더보기
                  <span className="ml-1.5 font-semibold text-slate-400">
                    (+{Math.min(PAGE_SIZE, sortedBestItems.length - visibleCount)})
                  </span>
                </button>
              )}
            </>
          )}
        </section>

        <footer className="mt-auto rounded-2xl bg-white/60 px-4 py-4 text-center ring-1 ring-rose-100/70 backdrop-blur-sm">
          <p className="text-[11px] leading-relaxed text-slate-500">
            본 서비스는 토스쇼핑 쉐어링크 활동의 일환으로 일정 수수료를 제공받을 수
            있습니다.
          </p>
        </footer>
      </div>
    </div>
  );
}
