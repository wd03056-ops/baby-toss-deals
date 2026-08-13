"use client";

import { useEffect, useRef, useState } from "react";
import {
  destroyAllTossBanners,
  getBannerAdGroupId,
  useTossBanner,
} from "@/hooks/useTossBanner";

/**
 * 웹뷰 하단 고정형 배너 광고 (리스트형).
 * 하단 네비게이션 위에 배치됩니다.
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
        theme: "auto",
        tone: "blackAndWhite",
        variant: "expanded",
        callbacks: {
          onAdRendered: (payload: any) => {
            console.log("[TossAds] 광고 렌더링 완료:", payload.slotId);
            setVisible(true);
          },
          onAdImpression: (payload: any) => {
            console.log("[TossAds] 광고 노출됨:", payload.slotId);
          },
          onAdViewable: (payload: any) => {
            console.log(
              "[TossAds] 광고 노출 기록됨 (수익 발생):",
              payload.slotId,
            );
          },
          onAdClicked: (payload: any) => {
            console.log("[TossAds] 광고 클릭됨:", payload.slotId);
          },
          onNoFill: (payload: any) => {
            console.warn("[TossAds] 표시할 광고가 없습니다:", payload.slotId);
            setVisible(false);
          },
          onAdFailedToRender: (payload: any) => {
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

  useEffect(() => {
    return () => {
      destroyAllTossBanners();
    };
  }, []);

  if (!supported) return null;

  return (
    <>
      <div
        aria-hidden
        className="shrink-0 transition-[height] duration-200"
        style={{ height: visible ? 96 : 0 }}
      />
      {/* 하단 네비(--bottom-nav-h) 바로 위에 고정 */}
      <div
        className="fixed inset-x-0 z-40"
        style={{
          bottom: "var(--bottom-nav-h, 64px)",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
        }}
        aria-hidden={!visible}
      >
        <div ref={containerRef} style={{ width: "100%", height: 96 }} />
      </div>
    </>
  );
}
