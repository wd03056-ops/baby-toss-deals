import HomeWrapper from "./home-wrapper";

/**
 * 앱인토스 비게임 가이드: SSR 금지 → CSR만 사용
 * @see https://developers-apps-in-toss.toss.im/checklist/app-nongame
 */
export const dynamic = "force-static";

export default function Page() {
  return <HomeWrapper />;
}
