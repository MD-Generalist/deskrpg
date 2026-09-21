import { LOCALE_COOKIE_NAME } from "./constants";
import en from "./locales/en";
import ja from "./locales/ja";
import ko from "./locales/ko";
import zh from "./locales/zh";

export type ServerLocale = "en" | "ko" | "ja" | "zh";

const translations: Record<ServerLocale, Record<string, string>> = {
  en,
  ko,
  ja,
  zh,
};

export function normalizeLocale(locale: string | null | undefined): ServerLocale {
  const base = locale?.toLowerCase().slice(0, 2);
  if (base === "ko" || base === "ja" || base === "zh") return base;
  return "en";
}

/**
 * 소켓 핸드셰이크의 Cookie 헤더에서 사용자가 고른 화면 언어를 꺼낸다. 브라우저가
 * `LOCALE_COOKIE_NAME` 쿠키를 같은 출처 소켓 연결에 자동으로 싣는다 — 새 이벤트
 * 필드 없이 서버가 "이 요청을 한 사람의 언어" 를 안다. 없으면 null(추측하지 않는다).
 */
export function readLocaleCookie(cookieHeader: string | null | undefined): ServerLocale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== LOCALE_COOKIE_NAME) continue;
    try {
      const raw = decodeURIComponent(part.slice(eq + 1).trim());
      return raw ? normalizeLocale(raw) : null;
    } catch {
      // 깨진 퍼센트 인코딩(`%E0%A4%A`)은 URIError 를 던진다 — 쿠키 하나 때문에 소켓 핸들러가 죽지 않게 한다.
      return null;
    }
  }
  return null;
}

export function translateServer(
  locale: ServerLocale | string | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const normalized = typeof locale === "string" ? normalizeLocale(locale) : "en";
  let text = translations[normalized][key] ?? translations.en[key] ?? key;

  if (params) {
    for (const [paramKey, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(value));
    }
  }

  return text;
}
