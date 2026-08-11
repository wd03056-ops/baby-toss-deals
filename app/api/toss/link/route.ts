import { NextRequest, NextResponse } from "next/server";
import { createShareLink, toTossErrorResponse } from "@/lib/toss-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/toss/link
 * body: { tacaItemId: number }
 *
 * 용어 문서: 링크 발급은 tacaItemId 사용 (tacaId 비권장)
 * 이동/게시는 shortUrl 또는 originUrl만 사용 (productUrl은 수익 미집계)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      tacaItemId?: number | string;
      /** @deprecated 호환용 — 내부적으로 tacaItemId로 취급 */
      productId?: number | string;
    };

    // tacaItemId 우선 (productId는 과거 호환, tacaId로 오인하지 않도록 동일 옵션 ID만 허용)
    const rawId = body.tacaItemId ?? body.productId;
    const tacaItemId = Number(rawId);

    if (!rawId || Number.isNaN(tacaItemId) || tacaItemId <= 0) {
      return NextResponse.json(
        {
          resultType: "FAIL",
          error: {
            errorCode: "INVALID_ARGUMENT",
            reason:
              "유효한 tacaItemId가 필요합니다. (상품 목록 API의 옵션 식별자)",
          },
        },
        { status: 400 },
      );
    }

    const link = await createShareLink(tacaItemId);

    return NextResponse.json({
      resultType: "SUCCESS",
      success: {
        tacaItemId: link.tacaItemId,
        publisherId: link.publisherId,
        shortUrl: link.shortUrl,
        originUrl: link.originUrl,
        shareUrl: link.shareUrl,
      },
      // 프론트 호환 필드
      tacaItemId: link.tacaItemId,
      shareUrl: link.shareUrl,
      shortUrl: link.shortUrl,
      originUrl: link.originUrl,
    });
  } catch (error) {
    console.error("[/api/toss/link]", error);
    const { status, body } = toTossErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
