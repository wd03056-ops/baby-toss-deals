import { defineConfig } from "@apps-in-toss/web-framework/config";

/**
 * 앱인토스 비게임 미니앱 설정
 * @see https://developers-apps-in-toss.toss.im/checklist/app-nongame
 */
export default defineConfig({
  appName: "tossbaby",
  brand: {
    // 화면에 노출되는 앱 기본 색상
    primaryColor: "#D99B82",
  },
  permissions: [],
  navigationBar: {
    // 토스 비게임 내비게이션 바 사용 (자체 뒤로가기와 중복 금지)
    withBackButton: true,
    withHomeButton: true,
    withTitle: true,
    theme: "light",
  },
  webView: {
    bounces: true,
    pullToRefreshEnabled: false,
    // 앱 스킴 진입 후 뒤로가기/제스처가 동작하도록
    allowsBackForwardNavigationGestures: true,
    overScrollMode: "never",
  },
});
