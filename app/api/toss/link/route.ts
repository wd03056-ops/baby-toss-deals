import { NextRequest, NextResponse } from "next/server";
import { createShareLink, TossApiError } from "@/lib/toss-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/toss/link
 * body: { productId: number } 또는 { tacaItemId: number }
 *
 * 토스 Open API POST /openapi/links 로 쉐어링크를 실시간 발급합니다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      productId?: number | string;
      tacaItemId?: number | string;
    };

    const rawId = body.productId ?? body.tacaItemId;
    const productId = Number(rawId);

    if (!rawId || Number.isNaN(productId) || productId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "유효한 productId(또는 tacaItemId)가 필요합니다.",
        },
        { status: 400 },
      );
    }

    const link = await createShareLink(productId);

    return NextResponse.json({
      success: true,
      productId: link.tacaItemId,
      shareUrl: link.shareUrl,
      shortUrl: link.shortUrl,
      originUrl: link.originUrl,
    });
  } catch (error) {
    console.error("[/api/toss/link]", error);

    if (error instanceof TossApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { success: false, error: "쉐어링크 발급 실패" },
      { status: 500 },
    );
  }
}
