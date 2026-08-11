"use client";

import { useEffect, useRef, useState } from "react";
import {
  destroyAllTossBanners,
  getBannerAdGroupId,
  useTossBanner,
} from "@/hooks/useTossBanner";

/**
 * 웹뷰 하단 고정형 배너 광고 (리스트형).
 * API 레퍼런스 옵션·콜백·destroy / destroyAll 전부 연결.
 * @see https://developers-apps-in-toss.toss.im/documentation/common/monetization/iaa/web-banner
 */
export default function BottomBannerAd() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isInitialized, supported, attachBanner } = useTossBanner();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isInitialized || !containerRef.current) return;

    const attached = attachBanner(
      getBannerAdGroupId(),
      containerRef.current,
      {
        // 문서 예제 프리셋
        theme: "auto",
        tone: "blackAndWhite",
        variant: "expanded",
        callbacks: {
          onAdRendered: (payload) => {
            console.log("[TossAds] 광고 렌더링 완료:", payload.slotId);
            setVisible(true);
          },
          onAdImpression: (payload) => {
            console.log("[TossAds] 광고 노출됨:", payload.slotId);
          },
          onAdViewable: (payload) => {
            console.log(
              "[TossAds] 광고 노출 기록됨 (수익 발생):",
              payload.slotId,
            );
          },
          onAdClicked: (payload) => {
            console.log("[TossAds] 광고 클릭됨:", payload.slotId);
          },
          onNoFill: (payload) => {
            console.warn("[TossAds] 표시할 광고가 없습니다:", payload.slotId);
            setVisible(false);
          },
          onAdFailedToRender: (payload) => {
            console.error(
              "[TossAds] 광고 렌더링 실패:",
              payload.error?.message ?? payload.error,
            );
            setVisible(false);
          },
        },
      },
    );

    return () => {
      attached?.destroy();
      setVisible(false);
    };
  }, [isInitialized, attachBanner]);

  // 페이지/컴포넌트 언마운트 시 모든 배너 슬롯 제거
  useEffect(() => {
    return () => {
      destroyAllTossBanners();
    };
  }, []);

  if (!supported) return null;

  return (
    <>
      {/* 고정 배너 높이만큼 본문 하단 여백 (노출 시에만) */}
      <div
        aria-hidden
        className="shrink-0 transition-[height] duration-200"
        style={{ height: visible ? 96 : 0 }}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-40"
        style={{
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        aria-hidden={!visible}
      >
        {/* 고정형: width 100% + height 96px — 내부는 비워 둠 */}
        <div ref={containerRef} style={{ width: "100%", height: 96 }} />
      </div>
    </>
  );
}
