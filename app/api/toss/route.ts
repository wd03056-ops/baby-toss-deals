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
      const babyDeals = (data.products || []).filter((item: TossRawProduct) => {
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

    // 2. 카테고리 베스트 (기본)
    // TOSS_BABY_CATEGORY_ID는 토스 어드민 문서의 출산/유아동 카테고리 ID 입력
    const categoryId = process.env.TOSS_BABY_CATEGORY_ID || "BABY";
    const res = await fetch(
      `${TOSS_API_BASE}/products/best?categoryId=${categoryId}&limit=20`,
      {
        headers,
        cache: "no-store",
      },
    );
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
      products: (data.products || []).map(normalizeProduct),
    });
  } catch (error) {
    console.error("[/api/toss]", error);
    return NextResponse.json(
      { success: false, error: "API 호출 실패" },
      { status: 500 },
    );
  }
}
