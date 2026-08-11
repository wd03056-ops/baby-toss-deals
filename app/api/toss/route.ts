import { NextRequest, NextResponse } from "next/server";

const TOSS_API_BASE = "https://api.toss.im/sharelink/v1";

type TossRawProduct = {
  productId?: string | number;
  tacaItemId?: number;
  productName?: string;
  displayName?: string;
  brandName?: string;
  brand?: string;
  categoryName?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  productUrl?: string;
  shortUrl?: string;
  price?: number;
  displayPrice?: number;
  originalPrice?: number;
  discountRate?: number;
  isSoldOut?: boolean;
  [key: string]: unknown;
};

type TossCategory = {
  id?: number | string;
  categoryId?: number | string;
  name?: string;
  displayName?: string;
  categoryName?: string;
  children?: TossCategory[];
  [key: string]: unknown;
};

const BABY_CATEGORY_KEYWORDS = ["유아", "출산", "아동", "유아동"] as const;

function normalizeProduct(item: TossRawProduct) {
  const displayName = item.displayName || item.productName || "";
  const displayPrice = item.displayPrice ?? item.price ?? 0;
  const originalPrice = item.originalPrice ?? displayPrice;
  const discountRate =
    item.discountRate ??
    (originalPrice > displayPrice
      ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100)
      : 0);

  return {
    tacaItemId: item.tacaItemId ?? (Number(item.productId) || 0),
    displayName,
    brandName: item.brandName || item.brand || "",
    thumbnailUrl: item.thumbnailUrl || item.imageUrl || "",
    productUrl: item.productUrl || item.shortUrl || "",
    shortUrl: item.shortUrl || item.productUrl || "",
    displayPrice,
    originalPrice,
    discountRate,
    isSoldOut: Boolean(item.isSoldOut),
    categoryName: item.categoryName || "",
  };
}

function getCategoryName(category: TossCategory) {
  return category.displayName || category.name || category.categoryName || "";
}

function getCategoryId(category: TossCategory) {
  const rawId = category.categoryId ?? category.id;
  return rawId === undefined || rawId === null ? null : String(rawId);
}

/** 카테고리 트리에서 유아/출산/아동 관련 카테고리 ID를 찾습니다. */
function findBabyCategoryId(categories: TossCategory[]): string | null {
  const queue = [...categories];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const name = getCategoryName(current);

    if (BABY_CATEGORY_KEYWORDS.some((keyword) => name.includes(keyword))) {
      return getCategoryId(current);
    }

    if (Array.isArray(current.children) && current.children.length > 0) {
      queue.push(...current.children);
    }
  }

  return null;
}

function extractCategories(data: Record<string, unknown>): TossCategory[] {
  if (Array.isArray(data.categories)) {
    return data.categories as TossCategory[];
  }

  // 공식 Open API 응답: { resultType, success: { categories } }
  const success = data.success as { categories?: TossCategory[] } | undefined;
  if (Array.isArray(success?.categories)) {
    return success.categories;
  }

  if (Array.isArray(data.data)) {
    return data.data as TossCategory[];
  }

  return [];
}

function extractProducts(data: Record<string, unknown>): TossRawProduct[] {
  if (Array.isArray(data.products)) {
    return data.products as TossRawProduct[];
  }

  const success = data.success as { items?: TossRawProduct[] } | undefined;
  if (Array.isArray(success?.items)) {
    return success.items;
  }

  if (Array.isArray(data.items)) {
    return data.items as TossRawProduct[];
  }

  return [];
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type"); // 'best' 또는 'daily'

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { success: false, error: "TOSS_SECRET_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };

  try {
    if (type === "daily") {
      // 1. 하루특가 불러와서 필터링
      const res = await fetch(`${TOSS_API_BASE}/products/daily-deals`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          {
            success: false,
            error: data?.message || data?.error || "하루특가 API 호출 실패",
          },
          { status: res.status },
        );
      }

      const babyRegex =
        /기저귀|분유|물티슈|아기|유아|젖병|장난감|유모차|카시트|베이비/;
      const babyDeals = extractProducts(data).filter((item) => {
        const isBabyCat =
          item.categoryName?.includes("유아") ||
          item.categoryName?.includes("출산");
        const isBabyName = babyRegex.test(
          item.productName || item.displayName || "",
        );
        return isBabyCat || isBabyName;
      });

      return NextResponse.json({
        success: true,
        products: babyDeals.map(normalizeProduct),
      });
    }

    // 2. 카테고리 조회 → 유아/출산/아동 카테고리 베스트 (없으면 전체 베스트)
    const categoryRes = await fetch(`${TOSS_API_BASE}/categories`, {
      headers,
      cache: "no-store",
    });
    const categoryData = await categoryRes.json();

    let babyCategoryId: string | null = null;

    if (categoryRes.ok) {
      const categories = extractCategories(categoryData);
      babyCategoryId = findBabyCategoryId(categories);
    } else {
      console.warn(
        "[/api/toss] 카테고리 조회 실패, 전체 베스트로 폴백합니다.",
        categoryData,
      );
    }

    // 환경변수로 카테고리 ID를 직접 지정한 경우 우선 사용
    if (!babyCategoryId && process.env.TOSS_BABY_CATEGORY_ID) {
      babyCategoryId = process.env.TOSS_BABY_CATEGORY_ID;
    }

    const bestUrl = babyCategoryId
      ? `${TOSS_API_BASE}/products/best?categoryId=${encodeURIComponent(babyCategoryId)}&limit=20`
      : `${TOSS_API_BASE}/products/best?limit=20`;

    const res = await fetch(bestUrl, {
      headers,
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data?.message || data?.error || "베스트 API 호출 실패",
        },
        { status: res.status },
      );
    }

    return NextResponse.json({
      success: true,
      categoryId: babyCategoryId,
      products: extractProducts(data).map(normalizeProduct),
    });
  } catch (error) {
    console.error("[/api/toss]", error);
    return NextResponse.json(
      { success: false, error: "API 호출 실패" },
      { status: 500 },
    );
  }
}
