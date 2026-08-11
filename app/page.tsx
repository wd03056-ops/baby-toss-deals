"use client";

import { useEffect, useState } from "react";

export type Product = {
  tacaItemId: number;
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
};

type ApiResponse = {
  success?: boolean;
  products?: Product[];
  error?: string;
};

function formatPrice(price: number) {
  return new Intl.NumberFormat("ko-KR").format(price);
}

function openProduct(url?: string) {
  if (!url) return;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function ProductCard({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const href = product.shortUrl || product.productUrl;

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={() => openProduct(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProduct(href);
        }
      }}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white/90 shadow-[0_8px_24px_rgba(255,160,180,0.12)] ring-1 ring-rose-100/80 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(255,140,170,0.2)] ${
        compact ? "w-[148px] shrink-0" : ""
      }`}
    >
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
            compact ? "min-h-[2.4em] text-xs leading-snug" : "min-h-[2.6em] text-sm leading-snug"
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
          onClick={(event) => {
            event.stopPropagation();
            openProduct(href);
          }}
          className={`mt-auto w-full rounded-xl bg-gradient-to-r from-[#FF8FAB] to-[#FF6B8A] font-bold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] ${
            compact ? "mt-2.5 py-2 text-[11px]" : "mt-3 py-2.5 text-xs"
          }`}
        >
          특가 보러가기
        </button>
      </div>
    </article>
  );
}

function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`animate-pulse overflow-hidden rounded-2xl bg-white/70 ring-1 ring-rose-100/60 ${
        compact ? "w-[148px] shrink-0" : ""
      }`}
    >
      <div className={`bg-rose-50/80 ${compact ? "aspect-square" : "aspect-[4/5]"}`} />
      <div className="space-y-2 p-3">
        <div className="h-3 rounded bg-rose-50" />
        <div className="h-3 w-2/3 rounded bg-rose-50" />
        <div className="h-8 rounded-xl bg-rose-100/70" />
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

  useEffect(() => {
    let cancelled = false;

    async function load(type: "best" | "daily") {
      try {
        const response = await fetch(`/api/toss?type=${type}`);
        const data = (await response.json()) as ApiResponse;

        if (!response.ok || data.success === false) {
          throw new Error(data.error || "상품을 불러오지 못했습니다.");
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

  const hideDaily =
    !dailyLoading && !dailyError && dailyItems.length === 0;

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
        <header className="mb-6 animate-[fadeUp_0.5s_ease-out]">
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

        <section
          className="mb-8 animate-[fadeUp_0.6s_ease-out]"
          style={{ display: hideDaily ? "none" : undefined }}
        >
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-800">
                오늘의 아기용품 하루특가
              </h2>
              <p className="text-xs text-slate-500">오늘만 이 가격, 놓치지 마세요</p>
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
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
              {dailyLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <SkeletonCard key={index} compact />
                  ))
                : dailyItems.map((product, index) => (
                    <ProductCard
                      key={`daily-${product.tacaItemId || index}`}
                      product={product}
                      compact
                    />
                  ))}
            </div>
          )}
        </section>

        <section className="mb-8 animate-[fadeUp_0.7s_ease-out]">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-800">
                아기용품 베스트 TOP 20
              </h2>
              <p className="text-xs text-slate-500">출산·유아동 카테고리 인기 상품</p>
            </div>
          </div>

          {bestError ? (
            <p className="rounded-2xl bg-white/80 px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-rose-100">
              {bestError}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {bestLoading
                ? Array.from({ length: 6 }).map((_, index) => (
                    <SkeletonCard key={index} />
                  ))
                : bestItems.map((product, index) => (
                    <ProductCard
                      key={`best-${product.tacaItemId || index}`}
                      product={product}
                    />
                  ))}
            </div>
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
