/**
 * 대화창 마크다운의 주소 정책.
 *
 * react-markdown 10 의 기본 `urlTransform` 은 `http(s)`·`irc(s)`·`mailto`·`xmpp` 와 상대경로만
 * 통과시키고 나머지 스킴을 **빈 문자열로 지운다**(`react-markdown/lib/index.js:124,421`).
 * 그래서 직원이 그림을 인라인 base64(`data:image/png;base64,…`)로 내면 화면에는
 * `src=""` 인 깨진 아이콘만 남는다 — 사용자에게 아무 단서가 없다(2026-09-20 실측).
 *
 * 그렇다고 `data:` 를 통째로 열면 안 된다. `data:image/svg+xml` 은 이미지가 아니라 `<script>`
 * 를 품는 문서이고, `data:text/html` 은 말할 것도 없다. 그래서 **이미지 자리(`<img src>`)의
 * 래스터 타입만** 연다 — 링크(`<a href>`)에는 열지 않는다.
 */
import { DATA_IMAGE_RASTER } from "./chat-file-link";

type UrlNode = { tagName?: string } | null | undefined;

const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/** react-markdown 의 기본 판정과 같다 — 프로토콜이 없으면 상대경로다. */
function isSafeByDefault(value: string): boolean {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");
  return (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  );
}

export function chatUrlTransform(value: string, key: string, node: UrlNode): string {
  if (isSafeByDefault(value)) return value;
  if (key === "src" && node?.tagName === "img" && DATA_IMAGE_RASTER.test(value)) return value;
  return "";
}
