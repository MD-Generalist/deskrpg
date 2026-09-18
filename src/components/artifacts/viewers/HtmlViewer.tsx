"use client";

/**
 * 웹 결과물을 격리된 iframe 에 그린다. `sandbox="allow-scripts"` 만 준다 — `allow-same-origin`
 * 을 더하면 결과물 스크립트가 DeskRPG 오리진(쿠키·API)에 닿으므로 절대 더하지 않는다.
 */

/** `<html`·`<!doctype` 가 없는 조각은 최소 문서로 감싼다(데스크톱 `composeArtifactHtml` 와 같은 모양). */
export function composeHtml(text: string): string {
  if (/<html[\s>]|<!doctype/i.test(text)) return text;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${text}</body></html>`;
}

export default function HtmlViewer({ text, title }: { text: string; title: string }) {
  return (
    <iframe
      sandbox="allow-scripts"
      srcDoc={composeHtml(text)}
      title={title}
      className="w-full h-full min-h-[60dvh] bg-white rounded-md border border-border"
    />
  );
}
