"use client";
import { useEffect, useState } from "react";

/** 이보다 긴 본문은 메인 스레드를 오래 잡지 않도록 강조하지 않는다. */
const HIGHLIGHT_MAX_CHARS = 100_000;

/**
 * shiki 를 지연 로드해 강조한 HTML 을 그린다. 모르는 언어·`text`·아주 긴 본문은 평문 `<pre>`
 * 로 남는다.
 */
export default function CodeViewer({ text, language }: { text: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const plain = language === "text" || text.length > HIGHLIGHT_MAX_CHARS;
  useEffect(() => {
    if (plain) return;
    let alive = true;
    void import("shiki")
      .then(({ codeToHtml }) => codeToHtml(text, { lang: language, theme: "github-dark" }))
      .catch(() => null)
      .then((out) => {
        if (alive) setHtml(out);
      });
    return () => {
      alive = false;
    };
  }, [text, language, plain]);
  if (plain || html === null)
    return <pre className="whitespace-pre-wrap font-mono text-xs">{text}</pre>;
  // shiki 출력은 코드 문자열을 이스케이프한 정적 HTML 이다(스크립트 없음).
  return (
    <div
      className="text-xs [&_pre]:p-3 [&_pre]:overflow-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
