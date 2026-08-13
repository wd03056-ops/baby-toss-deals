import { NextRequest } from "next/server";
import { corsJson, corsPreflight } from "@/lib/cors";
import { createShareLink, TossApiError } from "@/lib/toss-api";

export const dynamic = "force-dynamic";

function extractErrorMessage(error: unknown): string {
  if (error instanceof TossApiError) {
    const body = error.body;
    if (body && typeof body === "object") {
      const obj = body as {
        error?: string | { reason?: string; errorCode?: string; message?: string };
        reason?: string;
        message?: string;
      };
      if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
      if (obj.error && typeof obj.error === "object") {
        return (
          obj.error.reason ||
          obj.error.message ||
          obj.error.errorCode ||
          error.message
        );
      }
      if (typeof obj.reason === "string") return obj.reason;
      if (typeof obj.message === "string") return obj.message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "쉐어링크 발급 실패";
}

export async function OPTIONS() {
  return corsPreflight();
}

/**
 * POST /api/toss/link
 * body: { tacaItemId: number } 또는 { productId: number }
 *
 * 토스 Open API POST /openapi/links 로 추적 가능한 쉐어링크를 발급합니다.
 * 목록 API의 productUrl 은 수익 집계가 안 되므로 이 엔드포인트 결과만 사용하세요.
 * @see https://sharelink-docs.toss.im/guide/open-api/api/link.md
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      productId?: number | string;
      tacaItemId?: number | string;
    };

    const rawId = body.tacaItemId ?? body.productId;
    const tacaItemId = Number(rawId);

    if (!rawId || !Number.isFinite(tacaItemId) || tacaItemId <= 0) {
      return corsJson(
        {
          success: false,
          error: "유효한 tacaItemId가 필요합니다.",
        },
        { status: 400 },
      );
    }

    const link = await createShareLink(tacaItemId);

    return corsJson({
      success: true,
      tacaItemId: link.tacaItemId,
      productId: link.tacaItemId,
      /** shortUrl 우선 — 추적·수익 집계용 */
      shareUrl: link.shareUrl,
      shortUrl: link.shortUrl,
      originUrl: link.originUrl,
    });
  } catch (error) {
    console.error("[/api/toss/link]", error);
    const message = extractErrorMessage(error);
    const status =
      error instanceof TossApiError
        ? error.status === 429
          ? 429
          : error.status >= 400 && error.status < 600
            ? error.status
            : 502
        : 500;

    return corsJson(
      {
        success: false,
        error: message,
      },
      { status },
    );
  }
}
