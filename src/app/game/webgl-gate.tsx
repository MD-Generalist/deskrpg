"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";

import WebglUnavailable from "@/components/WebglUnavailable";
import { detectWebglSupport } from "@/lib/webgl-support";

// WebGL 가용성에는 구독할 이벤트가 없고, 한 페이지 수명 동안 바뀌지도 않는다
// (바뀌게 하는 유일한 조작인 "다시 시도" 는 전체 새로고침이다) — 한 번 재서 캐시한다.
const subscribeWebgl = () => () => {};
let cachedSupport: boolean | null = null;
function webglAvailable(): boolean {
  if (cachedSupport === null) {
    cachedSupport = detectWebglSupport(typeof document === "undefined" ? null : document);
  }
  return cachedSupport;
}
// 서버에서는 판정할 수 없다. `null` 은 "아직 검사 전" 이고, 하이드레이션 직후 클라이언트
// 스냅샷으로 갈린다 — `useState` 초기값으로 재면 서버·클라이언트 렌더가 어긋난다.
const serverWebglAvailable = () => null;

export type WebglGateProps = {
  /** WebGL 가용성 검사. 기본은 실제 `document` 로 캔버스를 만들어 본다. */
  detect?: () => boolean;
  /** 검사를 통과했을 때만 마운트한다. 인자는 세션 중 치명적 실패를 알리는 콜백이다. */
  renderWorkspace: (onFatal: () => void) => ReactNode;
  /** 검사가 끝나기 전에 보여줄 것. */
  renderChecking: () => ReactNode;
  /** "다시 시도" — 기본은 전체 새로고침이다. */
  onRetry?: () => void;
};

function reloadPage() {
  if (typeof window !== "undefined") window.location.reload();
}

/**
 * 채널 워크스페이스 앞을 지키는 관문. 검사를 통과할 때만 워크스페이스를 마운트한다 —
 * 실패하면 소켓 접속도, 캐릭터·채널 데이터 요청도 시작되지 않는다. 2D 폴백은 없다.
 *
 * 세션 중 렌더러가 죽으면 워크스페이스가 `onFatal` 을 부르고, 관문은 그 즉시
 * 워크스페이스를 내려 반쯤 살아 있는 채널 화면을 남기지 않는다.
 *
 * 워크스페이스를 element 가 아니라 콜백으로 받는 이유는 이 파일이 `GamePageClient` 를
 * import 하지 않기 위해서다 — 배선은 `GameWebglGate.tsx` 가 한다.
 */
export function WebglGate({ detect, renderWorkspace, renderChecking, onRetry }: WebglGateProps) {
  const supported = useSyncExternalStore<boolean | null>(
    subscribeWebgl,
    detect ?? webglAvailable,
    serverWebglAvailable,
  );
  const [fatal, setFatal] = useState(false);

  const handleFatal = useCallback(() => {
    setFatal(true);
  }, []);

  if (fatal || supported === false) return <WebglUnavailable onRetry={onRetry ?? reloadPage} />;
  if (supported === null) return <>{renderChecking()}</>;
  return <>{renderWorkspace(handleFatal)}</>;
}
