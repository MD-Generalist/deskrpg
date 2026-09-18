"use client";
import { useEffect, useState } from "react";

/** shiki 를 지연 로드해 강조한 HTML 을 그린다. 모르는 언어는 평문 `<pre>` 로 떨어진다. */
export default function CodeViewer({ text, language }: { text: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
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
  }, [text, language]);
  if (html === null) return <pre className="whitespace-pre-wrap font-mono text-xs">{text}</pre>;
  // shiki 출력은 코드 문자열을 이스케이프한 정적 HTML 이다(스크립트 없음).
  return (
    <div
      className="text-xs [&_pre]:p-3 [&_pre]:overflow-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
