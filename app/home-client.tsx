"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import BottomBannerAd from "@/components/BottomBannerAd";
import ProductDetailSheet from "@/components/ProductDetailSheet";
import { ensureAnonymousUserKey } from "@/lib/apps-in-toss";
import { apiUrl } from "@/lib/api-base";
import type { Product } from "@/types/product";

export type { Product };

type FeedKey = "best" | "daily" | "category";

type CategoryItem = {
  categoryId: number;
  displayName: string;
  level: number;
  path: string;
};

type ApiResponse = {
  success?: boolean;
  products?: Product[];
  categories?: CategoryItem[];
  empty?: boolean;
  cached?: boolean;
  stale?: boolean;
  fallback?: boolean;
  error?: string | { errorCode?: string; reason?: string } | null;
  resultType?: string;
  message?: string;
};

const CLIENT_FEED_MEMO_VERSION = "v53";

const clientFeedMemo = new Map<string, ApiResponse>();
const clientFeedInflight = new Map<string, Promise<ApiResponse>>();

function feedMemoKey(tab: FeedKey, categoryId?: number) {
  if (tab === "category") {
    return `${CLIENT_FEED_MEMO_VERSION}:category:${categoryId ?? "list"}`;
  }
  return `${CLIENT_FEED_MEMO_VERSION}:${tab}`;
}

function formatPrice(price: number | null | undefined) {
  const n = typeof price === "number" && Number.isFinite(price) ? price : 0;
  return new Intl.NumberFormat("ko-KR").format(n);
}

function formatReviewCount(count: number) {
  if (count >= 10_000) {
    return `${(count / 10_000).toFixed(1).replace(/\.0$/, "")}만`;
  }
  if (count >= 1000) {
    return new Intl.NumberFormat("ko-KR").format(count);
  }
  return String(count);
}

function formatScore(score: number) {
  return score.toFixed(1);
}

/** 별점·후기·배송 메타 (목록 API: reviewScore/reviewCount) */
function ProductMeta({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const score = product.reviewScore ?? 0;
  const count = product.reviewCount ?? 0;
  const hasReview = score > 0 || count > 0;

  const shippingLabel = (() => {
    if (product.isFreeShipping || product.shippingFee === 0) return "무료배송";
    if (typeof product.shippingFee === "number" && product.shippingFee > 0) {
      return `배송비 ${formatPrice(product.shippingFee)}원`;
    }
    if (product.deliveryType?.trim()) return product.deliveryType.trim();
    // Open API는 배송 필드를 보장하지 않음 — 토스쇼핑 상품임을 안내
    return "토스배송";
  })();

  const textSize = compact ? "text-[11px]" : "text-[12px]";

  return (
    <div className={`mt-1.5 flex flex-col gap-1 ${textSize}`}>
      {hasReview ? (
        <div className="flex items-center gap-1 rounded-md bg-[#f9fafb] px-1.5 py-1 text-[#4e5968]">
          <span className="inline-flex items-center gap-0.5 font-bold text-[#191f28]">
            <span className="text-[#f04452]" aria-hidden>
              ★
            </span>
            <span className="tabular-nums">{formatScore(score)}</span>
          </span>
          {count > 0 ? (
            <span className="tabular-nums font-medium text-[#6b7684]">
              ({formatReviewCount(count)})
            </span>
          ) : null}
          <span className="text-[#d1d6db]">·</span>
          <span className="font-medium text-[#6b7684]">후기</span>
        </div>
      ) : (
        <p className="rounded-md bg-[#f9fafb] px-1.5 py-1 text-[#b0b8c1]">
          후기 없음
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-[#f2f4f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#4e5968]">
          {shippingLabel}
        </span>
        {product.isSoldOut ? (
          <span className="inline-flex items-center rounded-md bg-[#fff1f0] px-1.5 py-0.5 text-[10px] font-semibold text-[#f04452]">
            품절
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md bg-[#e8f3ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#3182f6]">
            판매중
          </span>
        )}
      </div>
    </div>
  );
}

function getApiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  const err = obj.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const detail = err as {
      reason?: string;
      errorCode?: string;
      message?: string;
    };
    return detail.reason || detail.message || detail.errorCode || fallback;
  }
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (typeof obj.reason === "string" && obj.reason.trim()) return obj.reason;
  return fallback;
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchViaOurApi(url: string): Promise<ApiResponse> {
  const response = await fetch(url);
  const data = (await readJsonSafe(response)) as ApiResponse | null;

  if (response.ok && data && data.success !== false) {
    return {
      ...data,
      products: Array.isArray(data.products) ? data.products : [],
      categories: Array.isArray(data.categories) ? data.categories : [],
    };
  }

  if (data?.products || data?.categories || data?.fallback || data?.stale) {
    return {
      ...data,
      success: true,
      products: Array.isArray(data.products) ? data.products : [],
      categories: Array.isArray(data.categories) ? data.categories : [],
    };
  }

  throw new Error(getApiErrorMessage(data, "상품을 불러오지 못했습니다."));
}

async function loadFeedMemoized(
  tab: FeedKey,
  categoryId?: number,
): Promise<ApiResponse> {
  const key = feedMemoKey(tab, categoryId);
  const memo = clientFeedMemo.get(key);
  if (memo) return memo;

  const inflight = clientFeedInflight.get(key);
  if (inflight) return inflight;

  const url = apiUrl(
    tab === "best"
      ? "/api/toss?type=best"
      : tab === "daily"
        ? "/api/toss?type=daily"
        : categoryId
          ? `/api/toss?type=category-best&categoryId=${categoryId}`
          : "/api/toss?type=categories",
  );

  const promise = fetchViaOurApi(url)
    .then((data) => {
      clientFeedMemo.set(key, data);
      return data;
    })
    .finally(() => {
      clientFeedInflight.delete(key);
    });

  clientFeedInflight.set(key, promise);
  return promise;
}

function rankBadgeClass(rank: number) {
  if (rank === 1) return "bg-[#191f28] text-white";
  if (rank === 2) return "bg-[#4e5968] text-white";
  if (rank === 3) return "bg-[#8b95a1] text-white";
  return "bg-black/55 text-white backdrop-blur-[2px]";
}

/** null/undefined 필드가 있어도 UI가 깨지지 않도록 정규화 */
function sanitizeProduct(raw: Partial<Product> | null | undefined): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const tacaItemId = Number(raw.tacaItemId);
  if (!Number.isFinite(tacaItemId) || tacaItemId <= 0) return null;

  const displayPrice = Number(raw.displayPrice);
  const originalPrice = Number(raw.originalPrice);

  return {
    tacaItemId,
    displayName:
      typeof raw.displayName === "string" && raw.displayName.trim()
        ? raw.displayName
        : "상품명 없음",
    thumbnailUrl:
      typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : "",
    productUrl: typeof raw.productUrl === "string" ? raw.productUrl : "",
    displayPrice: Number.isFinite(displayPrice) && displayPrice >= 0 ? displayPrice : 0,
    originalPrice:
      Number.isFinite(originalPrice) && originalPrice >= 0 ? originalPrice : 0,
    discountRate: 0,
    isSoldOut: Boolean(raw.isSoldOut),
    brandName: typeof raw.brandName === "string" ? raw.brandName : "",
    endAt: typeof raw.endAt === "string" ? raw.endAt : undefined,
    rank: typeof raw.rank === "number" ? raw.rank : undefined,
    reviewScore:
      typeof raw.reviewScore === "number" && Number.isFinite(raw.reviewScore)
        ? raw.reviewScore
        : 0,
    reviewCount:
      typeof raw.reviewCount === "number" && Number.isFinite(raw.reviewCount)
        ? raw.reviewCount
        : 0,
    isFreeShipping: Boolean(raw.isFreeShipping),
    shippingFee:
      typeof raw.shippingFee === "number" && Number.isFinite(raw.shippingFee)
        ? raw.shippingFee
        : undefined,
    deliveryType:
      typeof raw.deliveryType === "string" ? raw.deliveryType : undefined,
  };
}

function sanitizeProducts(list: unknown): Product[] {
  if (!Array.isArray(list)) return [];
  const out: Product[] = [];
  for (const item of list) {
    const p = sanitizeProduct(item as Partial<Product>);
    if (p) out.push(p);
  }
  return out;
}

function filterProducts(items: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return items;
  return items.filter((product) => {
    const hay = `${product.displayName} ${product.brandName ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, "");
    return hay.includes(q);
  });
}

/** 정가·판매가 기준 할인율 (API 값 대신 재계산) */
function calcDiscountRate(
  originalPrice: number | null | undefined,
  price: number | null | undefined,
): number {
  const original = Number(originalPrice);
  const sale = Number(price);
  if (!Number.isFinite(original) || original <= 0) return 0;
  if (!Number.isFinite(sale) || sale < 0) return 0;
  if (sale >= original) return 0;
  return Math.round(((original - sale) / original) * 100);
}

function withComputedDiscount(product: Product): Product {
  return {
    ...product,
    discountRate: calcDiscountRate(product.originalPrice, product.displayPrice),
  };
}

type CurationKey = "all" | "crazy" | "under10k" | "highDiscount";

const CURATION_OPTIONS: { id: CurationKey; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "crazy", label: "🔥 미친 할인" },
  { id: "under10k", label: "🪙 만원의 행복" },
  { id: "highDiscount", label: "📊 할인율 높은순" },
];

/** 캐시된 배열만 필터/정렬 — 추가 API 호출 없음 */
function applyCuration(items: Product[], mode: CurationKey): Product[] {
  const list = items.map(withComputedDiscount);
  switch (mode) {
    case "crazy":
      return list.filter((p) => p.discountRate >= 50);
    case "under10k":
      return list.filter((p) => p.displayPrice <= 10_000);
    case "highDiscount":
      return [...list].sort(
        (a, b) =>
          b.discountRate - a.discountRate || a.displayPrice - b.displayPrice,
      );
    default:
      return list;
  }
}

/** tacaItemId 기준 중복 제거 병합 (검색용 전체 카탈로그) */
function mergeUniqueProducts(...lists: Product[][]): Product[] {
  const map = new Map<number, Product>();
  for (const list of lists) {
    for (const p of list) {
      if (!p.tacaItemId || map.has(p.tacaItemId)) continue;
      map.set(p.tacaItemId, p);
    }
  }
  return Array.from(map.values());
}

function formatRemainingHms(ms: number) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 오늘 자정(로컬)까지 남은 시간 — 하루특가 긴급감 */
function useEndOfDayCountdown() {
  const [remaining, setRemaining] = useState(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return Math.max(0, end.getTime() - Date.now());
  });

  useEffect(() => {
    const tick = () => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      setRemaining(Math.max(0, end.getTime() - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return remaining;
}

function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mb-4 px-4">
      <label className="sr-only" htmlFor="product-search">
        상품 검색
      </label>
      <span
        className="pointer-events-none absolute left-7 top-1/2 z-[1] -translate-y-1/2 text-[#8b95a1]"
        aria-hidden
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path
            d="M20 20l-3.5-3.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <input
        id="product-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-2xl border border-transparent bg-white py-3 pl-11 pr-10 text-[14px] text-[#191f28] shadow-sm outline-none placeholder:text-[#b0b8c1] focus:border-[#3182f6]/40 focus:ring-2 focus:ring-[#3182f6]/15"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-7 top-1/2 -translate-y-1/2 rounded-full bg-[#f2f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#6b7684]"
          aria-label="검색어 지우기"
        >
          지우기
        </button>
      ) : null}
    </div>
  );
}

function DailyUrgencyBanner({ remainingMs }: { remainingMs: number }) {
  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-2xl bg-gradient-to-r from-[#191f28] via-[#2b3340] to-[#f04452] p-4 text-white shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-wide text-white/70">
            TODAY ONLY
          </p>
          <p className="mt-1 text-[17px] font-extrabold leading-snug tracking-[-0.02em]">
            오늘만 이 가격
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/80">
            자정이 지나면 특가가 끝나요. 지금 바로 담아보세요.
          </p>
        </div>
        <div className="shrink-0 rounded-xl bg-white/15 px-3 py-2 text-center backdrop-blur-sm">
          <p className="text-[10px] font-semibold text-white/70">남은 시간</p>
          <p className="mt-0.5 font-mono text-[15px] font-bold tabular-nums tracking-wider">
            {formatRemainingHms(remainingMs)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 베스트/하루특가/카테고리 공통 카드 */
function GridProductCard({
  product,
  rank,
  onOpen,
  deal = false,
}: {
  product: Product;
  rank?: number;
  onOpen: (product: Product) => void;
  /** 하루특가 — 긴급감 UI */
  deal?: boolean;
}) {
  const discountRate = calcDiscountRate(
    product.originalPrice,
    product.displayPrice,
  );
  const isCrazyDeal = discountRate >= 50;

  return (
    <button
      type="button"
      aria-label={`${product.displayName} 상세 보기`}
      onClick={() => onOpen(product)}
      className={`group flex w-full flex-col rounded-2xl bg-white p-2 text-left outline-none transition active:scale-[0.98] shadow-[0_4px_16px_rgba(25,31,40,0.08)] ${
        deal ? "ring-1 ring-[#ffe3e6]" : "ring-1 ring-[#e8ebef]"
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-[#f2f4f6]">
        {product.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-[#b0b8c1]">
            이미지 없음
          </div>
        )}
        {typeof rank === "number" && rank > 0 && (
          <span
            className={`absolute left-2 top-2 z-[1] flex h-6 min-w-6 items-center justify-center rounded-lg px-1.5 text-[12px] font-bold tabular-nums ${rankBadgeClass(rank)}`}
          >
            {rank}
          </span>
        )}
        {isCrazyDeal ? (
          <span className="absolute right-2 top-2 z-[1] max-w-[72%] truncate rounded-md bg-[#f04452] px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
            🔥 역대급 특가
          </span>
        ) : deal ? (
          <span className="absolute right-2 top-2 z-[1] rounded-md bg-[#f04452] px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
            오늘만
          </span>
        ) : null}
        {product.isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#191f28]">
              품절
            </span>
          </div>
        )}
        {deal && discountRate > 0 && !isCrazyDeal && (
          <span className="absolute bottom-2 left-2 z-[1] rounded-lg bg-[#f04452] px-2 py-1 text-[18px] font-extrabold leading-none text-white tabular-nums shadow-md">
            {discountRate}%
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-col px-0.5 pb-1">
        {deal ? (
          <p className="mb-0.5 text-[10px] font-bold tracking-wide text-[#f04452]">
            오늘 하루만 · 특가
          </p>
        ) : null}
        <h3 className="line-clamp-2 min-h-[2.6em] text-[13px] font-medium leading-snug tracking-[-0.01em] text-[#333d4b]">
          {product.displayName}
        </h3>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {discountRate > 0 && (
            <span className="text-[18px] font-extrabold tabular-nums leading-none text-[#f04452]">
              {discountRate}%
            </span>
          )}
          <span className="text-[16px] font-extrabold tabular-nums tracking-tight text-[#191f28]">
            {formatPrice(product.displayPrice)}
            <span className="ml-0.5 text-[12px] font-semibold">원</span>
          </span>
        </div>
        {product.originalPrice > product.displayPrice && (
          <p className="mt-0.5 text-[12px] tabular-nums text-[#b0b8c1] line-through">
            {formatPrice(product.originalPrice)}원
          </p>
        )}

        <ProductMeta product={product} compact />
      </div>
    </button>
  );
}

/**
 * 가로 칩 스크롤 — 터치 스와이프 + PC 드래그/휠
 * 클릭은 칩 버튼이 받도록, 실제 드래그(이동) 이후에만 스크롤 처리
 */
function HorizontalChipScroll({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    tracking: boolean;
    dragging: boolean;
    pointerId: number | null;
    startX: number;
    startScroll: number;
    suppressClick: boolean;
  }>({
    tracking: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startScroll: 0,
    suppressClick: false,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const DRAG_THRESHOLD = 6;

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };

    const onPointerDown = (e: PointerEvent) => {
      // 터치는 네이티브 pan-x — 마우스만 드래그 스크롤
      if (e.pointerType === "touch") return;
      if (e.button !== 0) return;
      dragRef.current = {
        tracking: true,
        dragging: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startScroll: el.scrollLeft,
        suppressClick: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state.tracking || state.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.startX;
      if (!state.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        // 임계값 넘긴 뒤에만 드래그 시작 → 일반 클릭은 버튼 onClick 유지
        state.dragging = true;
        state.suppressClick = true;
        el.classList.add("is-dragging");
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      el.scrollLeft = state.startScroll - dx;
      e.preventDefault();
    };

    const endDrag = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state.tracking || state.pointerId !== e.pointerId) return;

      const wasDragging = state.dragging;
      state.tracking = false;
      state.dragging = false;
      state.pointerId = null;
      el.classList.remove("is-dragging");

      if (wasDragging) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!dragRef.current.suppressClick) return;
      dragRef.current.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("click", onClickCapture, true);

    return () => {
      el.classList.remove("is-dragging");
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`h-scroll-chips ${className}`.trim()}
      style={{ pointerEvents: "auto" }}
    >
      {children}
    </div>
  );
}

function CurationChips({
  value,
  onChange,
}: {
  value: CurationKey;
  onChange: (key: CurationKey) => void;
}) {
  return (
    <HorizontalChipScroll className="mb-3 px-4 pb-0.5">
      {CURATION_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`h-scroll-chip rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${
              active
                ? "is-active bg-[#191f28] text-white"
                : "bg-white text-[#4e5968]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </HorizontalChipScroll>
  );
}

function curationEmptyMessage(mode: CurationKey, searchQuery: string): string {
  if (searchQuery.trim()) {
    return `‘${searchQuery}’ 검색 결과가 없어요.`;
  }
  switch (mode) {
    case "crazy":
      return "할인율 50% 이상 상품이 없어요.";
    case "under10k":
      return "1만원 이하 상품이 없어요.";
    default:
      return "표시할 상품이 없어요.";
  }
}

function GridSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-2 shadow-[0_4px_16px_rgba(25,31,40,0.08)] ring-1 ring-[#e8ebef]">
      <div className="aspect-square rounded-xl skeleton-shimmer" />
      <div className="mt-2.5 space-y-2 px-0.5 pb-1">
        <div className="h-3.5 w-full rounded skeleton-shimmer" />
        <div className="h-3.5 w-2/3 rounded skeleton-shimmer" />
        <div className="h-4 w-1/2 rounded skeleton-shimmer" />
        <div className="h-5 w-3/4 rounded skeleton-shimmer" />
      </div>
    </div>
  );
}

type NavTab = "daily" | "best" | "category";

const BOTTOM_TABS: {
  id: NavTab;
  label: string;
  icon: (active: boolean) => ReactNode;
}[] = [
  {
    id: "daily",
    label: "하루특가",
    icon: (active) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <path
          d="M13 2L4 14h7l-1 8 10-14h-7l0-6z"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "best",
    label: "인기상품",
    icon: (active) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <path
          d="M12 3l2.4 6.6L21 10l-5 4.2L17.5 21 12 17.4 6.5 21 8 14.2 3 10l6.6-.4L12 3z"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "category",
    label: "카테고리",
    icon: (active) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <rect
          x="3"
          y="3"
          width="8"
          height="8"
          rx="2"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="13"
          y="3"
          width="8"
          height="8"
          rx="2"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="3"
          y="13"
          width="8"
          height="8"
          rx="2"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="13"
          y="13"
          width="8"
          height="8"
          rx="2"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
];

function BottomNav({
  active,
  onChange,
}: {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[#e5e8eb] bg-white/95 backdrop-blur-md"
      style={{
        height: "var(--bottom-nav-h)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="하단 메뉴"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch">
        {BOTTOM_TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition ${
                isActive ? "text-[#3182f6]" : "text-[#8b95a1]"
              }`}
            >
              {tab.icon(isActive)}
              <span
                className={`text-[11px] ${
                  isActive ? "font-bold" : "font-medium"
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function sortCategoriesPreferHome(cats: CategoryItem[]): CategoryItem[] {
  const score = (c: CategoryItem) => {
    const text = `${c.displayName} ${c.path}`;
    if (/가구\s*\/\s*홈데코|가구\/홈데코/.test(text)) return 0;
    if (/홈데코/.test(text)) return 1;
    if (/가구/.test(text)) return 2;
    if (/인테리어|리빙|생활/.test(text)) return 3;
    return 10;
  };
  return [...cats].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return a.displayName.localeCompare(b.displayName, "ko");
  });
}

function pickDefaultCategoryId(cats: CategoryItem[]): number | null {
  if (cats.length === 0) return null;
  const preferred = cats.find((c) =>
    /가구|홈데코/.test(`${c.displayName}${c.path}`),
  );
  return (preferred ?? cats[0]).categoryId;
}

export default function HomeClient() {
  const [navTab, setNavTab] = useState<NavTab>("daily");
  const [dailyItems, setDailyItems] = useState<Product[]>([]);
  const [bestItems, setBestItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [categoryItems, setCategoryItems] = useState<Product[]>([]);
  /** 모든 카테고리 상품 합본 — 검색 시 카테고리 구분 없이 사용 */
  const [categoryCatalog, setCategoryCatalog] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [bestLoading, setBestLoading] = useState(true);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [curation, setCuration] = useState<CurationKey>("all");
  const remainingMs = useEndOfDayCountdown();

  const hasSearch = searchQuery.trim().length > 0;
  const categorySearchPool = mergeUniqueProducts(
    categoryCatalog,
    dailyItems,
    bestItems,
  );
  const filteredDaily = applyCuration(
    filterProducts(dailyItems, searchQuery),
    curation,
  );
  const filteredBest = applyCuration(
    filterProducts(bestItems, searchQuery),
    curation,
  );
  const filteredCategory = applyCuration(
    filterProducts(
      hasSearch ? categorySearchPool : categoryItems,
      searchQuery,
    ),
    curation,
  );

  // 받은 데이터 전부 렌더 (개수 제한/slice 없음). 스크롤은 브라우저 네이티브.
  const visibleDaily = filteredDaily;
  const visibleBest = filteredBest;
  const visibleCategory = filteredCategory;

  useEffect(() => {
    void ensureAnonymousUserKey();
  }, []);

  // 탭 전환 시 검색어·큐레이션·스크롤 위치 초기화
  useEffect(() => {
    setSearchQuery("");
    setCuration("all");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [navTab]);

  // 홈: 하루특가 + 베스트 + 카테고리 목록 병렬 로드 (서버 캐시/세션 메모로 할당량 보호)
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setDailyLoading(true);
      setBestLoading(true);
      setCategoriesLoading(true);
      setError(null);

      const [dailyResult, bestResult, catResult] = await Promise.allSettled([
        loadFeedMemoized("daily"),
        loadFeedMemoized("best"),
        loadFeedMemoized("category"),
      ]);

      if (cancelled) return;

      if (dailyResult.status === "fulfilled") {
        const products = sanitizeProducts(dailyResult.value.products);
        console.log("[feed] daily 전체 상품 개수(API):", products.length);
        setDailyItems(products);
      }
      if (bestResult.status === "fulfilled") {
        const products = sanitizeProducts(bestResult.value.products);
        console.log("[feed] best 전체 상품 개수(API):", products.length);
        setBestItems(products);
      }
      if (catResult.status === "fulfilled") {
        const all = catResult.value.categories ?? [];
        const top =
          all.filter((c) => c.level === 1).length > 0
            ? all.filter((c) => c.level === 1)
            : all;
        const sorted = sortCategoriesPreferHome(top);
        setCategories(sorted);
        // 카테고리 탭 진입 시 가구/홈데코부터 바로 상품 노출
        setSelectedCategoryId((prev) => prev ?? pickDefaultCategoryId(sorted));
      }

      const failed =
        dailyResult.status === "rejected" &&
        bestResult.status === "rejected" &&
        catResult.status === "rejected";
      if (failed) {
        setError("상품을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.");
      }

      setDailyLoading(false);
      setBestLoading(false);
      setCategoriesLoading(false);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // 카테고리 탭 진입 시 전체 카테고리 상품 백그라운드 로드 (검색은 카테고리 구분 없이)
  useEffect(() => {
    if (navTab !== "category") return;
    if (categories.length === 0) return;
    if (categoryCatalog.length > 0) return;

    let cancelled = false;
    setCatalogLoading(true);

    void Promise.allSettled(
      categories.map((c) => loadFeedMemoized("category", c.categoryId)),
    ).then((results) => {
      if (cancelled) return;
      const merged: Product[] = [];
      const seen = new Set<number>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const p of sanitizeProducts(r.value.products)) {
          if (seen.has(p.tacaItemId)) continue;
          seen.add(p.tacaItemId);
          merged.push(p);
        }
      }
      console.log("[feed] categoryCatalog 전체 상품 개수:", merged.length);
      setCategoryCatalog(merged);
      setCatalogLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // categoryCatalog.length는 “이미 로드됨” 가드용 — 완료 후 재실행 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTab, categories]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setCategoryItems([]);
      return;
    }

    let cancelled = false;
    setCategoryLoading(true);

    void loadFeedMemoized("category", selectedCategoryId)
      .then((data) => {
        if (cancelled) return;
        const products = sanitizeProducts(data.products);
        const selectedCategory =
          categories.find((c) => c.categoryId === selectedCategoryId)
            ?.displayName ?? String(selectedCategoryId);
        console.log(
          `[Category: ${selectedCategory}] Total items: ${products.length}`,
        );
        setCategoryItems(products);
      })
      .catch(() => {
        if (cancelled) return;
        setCategoryItems([]);
      })
      .finally(() => {
        if (!cancelled) setCategoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, categories]);

  // 카테고리 탭으로 들어오면 선택값이 없을 때 가구/홈데코(또는 첫 카테고리) 자동 선택
  useEffect(() => {
    if (navTab !== "category") return;
    if (selectedCategoryId != null) return;
    if (categories.length === 0) return;
    setSelectedCategoryId(pickDefaultCategoryId(categories));
  }, [navTab, selectedCategoryId, categories]);

  // 디버그: 전체 수신 vs 현재 렌더 개수
  useEffect(() => {
    if (navTab === "daily") {
      console.log("[render] daily", {
        apiTotal: dailyItems.length,
        afterFilter: filteredDaily.length,
        rendered: visibleDaily.length,
      });
    } else if (navTab === "best") {
      console.log("[render] best", {
        apiTotal: bestItems.length,
        afterFilter: filteredBest.length,
        rendered: visibleBest.length,
      });
    } else {
      console.log("[render] category", {
        apiTotal: hasSearch ? categoryCatalog.length : categoryItems.length,
        afterFilter: filteredCategory.length,
        rendered: visibleCategory.length,
      });
    }
  }, [
    navTab,
    hasSearch,
    dailyItems.length,
    bestItems.length,
    categoryItems.length,
    categoryCatalog.length,
    filteredDaily.length,
    filteredBest.length,
    filteredCategory.length,
    visibleDaily.length,
    visibleBest.length,
    visibleCategory.length,
  ]);

  const headerTitle =
    navTab === "daily"
      ? "오늘 단 하루 특가"
      : navTab === "best"
        ? "인기상품"
        : "카테고리";
  const headerSubtitle =
    navTab === "daily"
      ? null
      : navTab === "best"
        ? "지금 많이 찾는 상품"
        : "관심 카테고리를 골라보세요";

  const searchPlaceholder =
    navTab === "daily"
      ? "하루특가 상품 검색"
      : navTab === "best"
        ? "인기상품 검색"
        : "전체 상품 검색";

  const categoryShowingSearch = navTab === "category" && hasSearch;
  const categoryListLoading = categoryShowingSearch
    ? catalogLoading && categorySearchPool.length === 0
    : categoryLoading || !selectedCategoryId;

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#f2f4f6] text-[#191f28]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-toss-atmosphere"
      />

      <div
        className="relative mx-auto flex min-h-dvh w-full min-w-0 max-w-lg flex-col pt-4"
        style={{
          paddingBottom:
            "calc(var(--bottom-nav-h) + 12px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <header className="mb-3 px-4 animate-[fadeUp_0.4s_ease-out]">
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-[#191f28]">
            {headerTitle}
          </h1>
          {navTab === "daily" ? (
            <p className="mt-1.5 text-[14px] font-bold leading-relaxed tracking-[-0.02em] text-[#3182f6]">
              자정까지 · 오늘만 이 가격
            </p>
          ) : headerSubtitle ? (
            <p className="mt-1 text-[13px] leading-relaxed text-[#6b7684]">
              {headerSubtitle}
            </p>
          ) : null}
        </header>

        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={searchPlaceholder}
        />

        <CurationChips value={curation} onChange={setCuration} />

        {error ? (
          <p className="mx-4 mb-6 rounded-2xl bg-white px-4 py-8 text-center text-[14px] text-[#6b7684] shadow-sm">
            {error}
          </p>
        ) : null}

        {navTab === "daily" && (
          <section className="mb-4 animate-[fadeUp_0.35s_ease-out]">
            <DailyUrgencyBanner remainingMs={remainingMs} />
            <div className="px-4">
              {dailyLoading ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <GridSkeleton key={`deal-skel-${i}`} />
                  ))}
                </div>
              ) : dailyItems.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-[14px] text-[#6b7684] shadow-sm">
                  현재 진행 중인 특가 상품이 없습니다.
                </p>
              ) : filteredDaily.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-[14px] text-[#6b7684] shadow-sm">
                  {curationEmptyMessage(curation, searchQuery)}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {visibleDaily.map((product, index) => (
                      <GridProductCard
                        key={`daily-${product.tacaItemId || index}`}
                        product={product}
                        rank={index + 1}
                        deal
                        onOpen={setSelectedProduct}
                      />
                    ))}
                  </div>
                  <p className="py-5 text-center text-[12px] text-[#8b95a1]">
                    전체 {filteredDaily.length.toLocaleString("ko-KR")}개
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {navTab === "best" && (
          <section className="mb-4 animate-[fadeUp_0.35s_ease-out]">
            <div className="px-4">
              {bestLoading ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <GridSkeleton key={`best-skel-${i}`} />
                  ))}
                </div>
              ) : bestItems.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-[14px] text-[#6b7684] shadow-sm">
                  현재 확인할 수 있는 인기 상품이 없어요.
                </p>
              ) : filteredBest.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-[14px] text-[#6b7684] shadow-sm">
                  {curationEmptyMessage(curation, searchQuery)}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {visibleBest.map((product, index) => (
                      <GridProductCard
                        key={`best-${product.tacaItemId || index}`}
                        product={product}
                        rank={index + 1}
                        onOpen={setSelectedProduct}
                      />
                    ))}
                  </div>
                  <p className="py-5 text-center text-[12px] text-[#8b95a1]">
                    전체 {filteredBest.length.toLocaleString("ko-KR")}개
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {navTab === "category" && (
          <section className="mb-4 animate-[fadeUp_0.35s_ease-out]">
            {!categoryShowingSearch && (
              <HorizontalChipScroll className="mb-4 px-4 pb-1">
                {categoriesLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={`cat-skel-${i}`}
                        className="h-scroll-chip h-8 w-16 rounded-full skeleton-shimmer"
                      />
                    ))
                  : categories.map((cat) => {
                      const active = selectedCategoryId === cat.categoryId;
                      return (
                        <button
                          key={cat.categoryId}
                          type="button"
                          onClick={() => setSelectedCategoryId(cat.categoryId)}
                          className={`h-scroll-chip rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${
                            active
                              ? "is-active bg-[#3182f6] text-white"
                              : "bg-white text-[#4e5968]"
                          }`}
                        >
                          {cat.displayName}
                        </button>
                      );
                    })}
              </HorizontalChipScroll>
            )}

            {categoryShowingSearch ? (
              <p className="mb-3 px-4 text-[12px] font-medium text-[#6b7684]">
                전체 카테고리에서 ‘{searchQuery.trim()}’ 검색
                {catalogLoading ? " · 불러오는 중…" : ""}
              </p>
            ) : null}

            <div className="px-4">
              {categoryListLoading ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <GridSkeleton key={`cat-prod-skel-${i}`} />
                  ))}
                </div>
              ) : !categoryShowingSearch && categoryItems.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-7 text-center text-[13px] text-[#8b95a1] shadow-sm">
                  이 카테고리에 표시할 상품이 없어요.
                </p>
              ) : filteredCategory.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-7 text-center text-[13px] text-[#8b95a1] shadow-sm">
                  {curationEmptyMessage(curation, searchQuery)}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {visibleCategory.map((product, index) => (
                      <GridProductCard
                        key={`cat-${product.tacaItemId || index}`}
                        product={product}
                        rank={index + 1}
                        onOpen={setSelectedProduct}
                      />
                    ))}
                  </div>
                  <p className="py-5 text-center text-[12px] text-[#8b95a1]">
                    전체 {filteredCategory.length.toLocaleString("ko-KR")}개
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        <footer className="mt-auto px-4 pt-4">
          <p className="rounded-2xl bg-white/80 px-4 py-3.5 text-center text-[11px] leading-relaxed text-[#8b95a1] shadow-sm">
            본 서비스는 토스쇼핑 쉐어링크 활동의 일환으로 일정 수수료를 제공받을 수
            있습니다.
          </p>
        </footer>

        <BottomBannerAd />
      </div>

      <BottomNav active={navTab} onChange={setNavTab} />

      {selectedProduct && (
        <ProductDetailSheet
          listProduct={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}
