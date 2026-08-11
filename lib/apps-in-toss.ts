const ANON_KEY_STORAGE = "tossbaby:anonymousUserKey";

/**
 * 외부 URL을 앱인토스 Device.openURL로 엽니다.
 * 브라우저(로컬 개발)에서는 window.open / location.assign 폴백.
 * location.replace로 자사 사이트 유도하는 방식은 사용하지 않습니다.
 */
export async function openExternalUrl(url?: string): Promise<void> {
  if (!url) return;

  try {
    const { Device } = await import("@apps-in-toss/web-framework");
    await Device.openURL(url);
    return;
  } catch {
    // 토스 웹뷰 밖(로컬 브라우저)에서는 네이티브 브릿지가 없을 수 있음
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.assign(url);
  }
}

/**
 * 사용자 식별키를 확인하고 Storage에 저장합니다.
 * 토스 앱 밖에서는 localStorage로 개발용 키를 유지합니다.
 */
export async function ensureAnonymousUserKey(): Promise<string | null> {
  try {
    const { User, Storage } = await import("@apps-in-toss/web-framework");

    if (User.getAnonymousKey.isSupported()) {
      const result = await User.getAnonymousKey();
      if (result?.type === "HASH" && result.hash) {
        await Storage.setItem(ANON_KEY_STORAGE, result.hash);
        return result.hash;
      }
    }

    const existing = await Storage.getItem(ANON_KEY_STORAGE);
    if (existing) return existing;
  } catch {
    // 브라우저 폴백
  }

  try {
    const existing = window.localStorage.getItem(ANON_KEY_STORAGE);
    if (existing) return existing;

    const fallback = `dev-${crypto.randomUUID()}`;
    window.localStorage.setItem(ANON_KEY_STORAGE, fallback);
    return fallback;
  } catch {
    return null;
  }
}
