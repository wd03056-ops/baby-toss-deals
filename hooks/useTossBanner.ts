"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TossAds,
  getTossAppVersion,
  isMinVersionSupported,
  type TossAdsAttachBannerOptions,
  type TossAdsAttachBannerResult,
} from "@apps-in-toss/web-framework";

/** 배너 광고 최소 토스 앱 버전 (문서: 5.241.0 이상) */
export const BANNER_MIN_VERSION = {
  android: "5.241.0",
  ios: "5.241.0",
} as const;

/** 배너 광고 - 리스트형 테스트 ID */
export const TOSS_ADS_TEST_BANNER_ID = "ait-ad-test-banner-id";

/** 배너 광고 - 피드형 테스트 ID (문서 참고용, 하단 고정에는 리스트형 사용) */
export const TOSS_ADS_TEST_NATIVE_IMAGE_ID = "ait-ad-test-native-image-id";

let initPromise: Promise<boolean> | null = null;

export function getBannerAdGroupId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_TOSS_ADS_BANNER_ID?.trim();
  return fromEnv || TOSS_ADS_TEST_BANNER_ID;
}

/** TossAds 메서드에 isSupported가 있는지 안전하게 확인 */
function isTossAdsMethodSupported(
  method: { isSupported?: () => boolean } | undefined | null,
): boolean {
  try {
    return typeof method?.isSupported === "function" && method.isSupported();
  } catch {
    return false;
  }
}

/**
 * 배너 광고 API 사용 가능 여부.
 * 5.241.0 미만은 빈 화면이 나올 수 있어 반드시 예외 처리.
 */
export function isTossBannerSupported(): boolean {
  try {
    if (!isTossAdsMethodSupported(TossAds?.initialize)) return false;
    if (!isTossAdsMethodSupported(TossAds?.attachBanner)) return false;

    if (!isMinVersionSupported(BANNER_MIN_VERSION)) {
      try {
        console.warn(
          `[TossAds] 배너 광고는 토스앱 5.241.0 이상에서만 지원합니다. 현재: ${getTossAppVersion()}`,
        );
      } catch {
        console.warn("[TossAds] 배너 광고는 토스앱 5.241.0 이상에서만 지원합니다.");
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * TossAds SDK를 앱에서 한 번만 초기화합니다.
 * @see https://developers-apps-in-toss.toss.im/documentation/common/monetization/iaa/web-banner
 */
export function ensureTossAdsInitialized(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve) => {
    if (!isTossAdsMethodSupported(TossAds?.initialize)) {
      console.warn("[TossAds] 배너 광고 기능을 사용할 수 없습니다.");
      resolve(false);
      return;
    }

    if (!isMinVersionSupported(BANNER_MIN_VERSION)) {
      try {
        console.warn(
          `[TossAds] 토스앱 버전 미지원. 현재: ${getTossAppVersion()}`,
        );
      } catch {
        console.warn("[TossAds] 토스앱 버전 미지원 (5.241.0 미만).");
      }
      resolve(false);
      return;
    }

    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: () => {
            console.log("[TossAds] SDK 초기화 완료");
            resolve(true);
          },
          onInitializationFailed: (error) => {
            console.error("[TossAds] SDK 초기화 실패:", error);
            resolve(false);
          },
        },
      });
    } catch (error) {
      console.error("[TossAds] SDK 초기화 오류:", error);
      resolve(false);
    }
  });

  return initPromise;
}

/** 모든 배너 슬롯 제거 */
export function destroyAllTossBanners(): void {
  try {
    if (!isTossAdsMethodSupported(TossAds?.destroyAll)) return;
    TossAds.destroyAll();
  } catch (error) {
    console.error("[TossAds] destroyAll 실패:", error);
  }
}

/**
 * 문서의 useTossBanner 패턴:
 * SDK 초기화 + attachBanner 헬퍼.
 */
export function useTossBanner() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const ok = isTossBannerSupported();
    setSupported(ok);
    if (!ok) return;

    let cancelled = false;
    void ensureTossAdsInitialized().then((initialized) => {
      if (!cancelled) setIsInitialized(initialized);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const attachBanner = useCallback(
    (
      adGroupId: string,
      element: HTMLElement,
      options?: TossAdsAttachBannerOptions,
    ): TossAdsAttachBannerResult | undefined => {
      if (!isInitialized) return undefined;
      if (!isTossAdsMethodSupported(TossAds?.attachBanner)) return undefined;
      return TossAds.attachBanner(adGroupId, element, options);
    },
    [isInitialized],
  );

  return { isInitialized, supported, attachBanner };
}
