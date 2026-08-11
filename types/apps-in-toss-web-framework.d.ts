/**
 * @apps-in-toss/web-framework 패키지가 없거나 미설치여도
 * 빌드/타입체크가 깨지지 않도록 하는 ambient 모듈 선언
 */
declare module "@apps-in-toss/web-framework" {
  export type TossAdsAttachBannerOptions = {
    theme?: "auto" | "light" | "dark";
    tone?: "blackAndWhite" | "grey";
    variant?: "card" | "expanded";
    callbacks?: {
      onAdRendered?: (payload: any) => void;
      onAdImpression?: (payload: any) => void;
      onAdViewable?: (payload: any) => void;
      onAdClicked?: (payload: any) => void;
      onNoFill?: (payload: any) => void;
      onAdFailedToRender?: (payload: any) => void;
    };
  };

  export type TossAdsAttachBannerResult = {
    destroy: () => void;
  };

  export type TossAdsInitializeOptions = {
    callbacks?: {
      onInitialized?: () => void;
      onInitializationFailed?: (error: any) => void;
    };
  };

  type SupportedFn = (() => void) & {
    isSupported: () => boolean;
  };

  export const TossAds: {
    initialize: ((options: TossAdsInitializeOptions) => void) & {
      isSupported: () => boolean;
    };
    attachBanner: ((
      adGroupId: string,
      target: string | HTMLElement,
      options?: TossAdsAttachBannerOptions,
    ) => TossAdsAttachBannerResult) & {
      isSupported: () => boolean;
    };
    destroyAll: (() => void) & {
      isSupported: () => boolean;
    };
    destroy: ((slotId: string) => void) & {
      isSupported: () => boolean;
    };
  };

  export function getTossAppVersion(): string;

  export function isMinVersionSupported(minVersions: {
    android: string;
    ios: string;
  }): boolean;

  export const Device: {
    openURL: (url: string) => Promise<void>;
  };

  export const User: {
    getAnonymousKey: (() => Promise<{ type: string; hash: string }>) & {
      isSupported: () => boolean;
    };
  };

  export const Storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    clearItems: () => Promise<void>;
  };
}

declare module "@apps-in-toss/web-framework/config" {
  export type AppsInTossConfig = {
    appName: string;
    brand: { primaryColor: string };
    permissions: unknown[];
    navigationBar?: Record<string, unknown>;
    webView?: Record<string, unknown>;
    webBundleDir?: string;
  };

  export function defineConfig(config: AppsInTossConfig): AppsInTossConfig;
}
