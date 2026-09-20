/**
 * "한 줄에 링크만 있는 문단"을 판정한다 — 그 문단만 미리보기 카드로 승격한다.
 *
 * 문장 안의 링크는 그대로 둔다(글 흐름이 끊긴다). 사람이 제목을 붙인 링크
 * (`[제목](URL)`)도 그대로 둔다 — 카드가 그 제목을 남의 og:title 로 덮어쓰게 된다.
 * 파일 링크도 제외한다 — 거기에는 이미 내려받기 아이콘이 붙는다(`chat-file-link.ts`).
 *
 * 순수 함수. react-markdown 이 주는 hast 노드의 모양만 최소로 받는다.
 */
import { chatFileLink } from "@/lib/chat-file-link";

type MinimalNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: MinimalNode[];
};

function textOf(node: MinimalNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

export function soleLinkUrl(node: { children?: MinimalNode[] } | undefined): string | null {
  const children = (node?.children ?? []).filter(
    (child) => !(child.type === "text" && !(child.value ?? "").trim()),
  );
  if (children.length !== 1) return null;

  const only = children[0];
  if (only.tagName !== "a") return null;
  const href = only.properties?.href;
  if (typeof href !== "string") return null;

  // 보이는 글자가 주소 그대로일 때만. 끝의 `/` 하나는 브라우저·마크다운이 다르게 쓴다.
  const label = textOf(only).trim();
  if (label !== href && label !== href.replace(/\/$/, "")) return null;

  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (chatFileLink(href)) return null;
  return href;
}
