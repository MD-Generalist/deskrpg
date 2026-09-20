"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Copy, Check, Download } from "lucide-react";

import { chatFileLink } from "@/lib/chat-file-link";
import { chatUrlTransform } from "@/lib/markdown-url";
import { soleLinkUrl } from "@/lib/link-preview/promote";
import { useT } from "@/lib/i18n";

import LinkPreviewCard from "./LinkPreviewCard";

// ─── Code block with copy button ────────────────────────────────────

function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = typeof children === "string" ? children : extractText(children);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  return (
    <div className="my-1.5 rounded-md overflow-hidden relative group">
      <div className="flex items-center justify-between bg-surface px-2 py-0.5">
        <span className="text-text-dim text-[10px]">{lang || "code"}</span>
        <button
          onClick={handleCopy}
          className="text-text-dim hover:text-text transition-colors p-0.5"
          title="Copy"
        >
          {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="bg-bg/80 px-2.5 py-2 overflow-x-auto text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

// ─── Markdown components ────────────────────────────────────────────

/**
 * 파일 링크 옆에 붙는 내려받기 아이콘. 대화 중에 받은 문서·그림을 저장할 방법이
 * 새 탭 열기뿐이던 것을 없앤다(결과물 뷰어·카드 첨부에만 있던 버튼을 여기에도 준다).
 */
function DownloadLink({
  href,
  filename,
  label,
}: {
  href: string;
  filename: string | undefined;
  label: string;
}) {
  return (
    <a
      href={href}
      download={filename ?? ""}
      title={label}
      aria-label={label}
      className="inline-flex align-middle ml-1 text-text-dim hover:text-text"
    >
      <Download className="w-3.5 h-3.5" />
    </a>
  );
}

function buildComponents(t: (key: string) => string): Components {
  const download = t("chat.download");
  return {
    h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
    h2: ({ children }) => <h2 className="text-base font-bold mt-2.5 mb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-0.5">{children}</h3>,
    h4: ({ children }) => <h4 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h4>,
    h5: ({ children }) => <h5 className="text-sm font-medium mt-1 mb-0.5">{children}</h5>,
    h6: ({ children }) => (
      <h6 className="text-xs font-medium mt-1 mb-0.5 text-text-muted">{children}</h6>
    ),
    p: ({ children, node }) => {
      const paragraph = <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>;
      // 한 줄에 링크만 있는 문단만 카드로 승격한다 — 판정은 promote.ts, 실패 시 이 문단 그대로.
      const url = soleLinkUrl(node);
      return url ? <LinkPreviewCard url={url} fallback={paragraph} /> : paragraph;
    },
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through opacity-60">{children}</del>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-text-dim pl-2 my-1.5 text-text-muted italic">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => {
      const file = chatFileLink(href);
      return (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:brightness-125"
          >
            {children}
          </a>
          {file && <DownloadLink href={file.href} filename={file.filename} label={download} />}
        </>
      );
    },
    code: ({ className, children }) => {
      const isBlock = className?.startsWith("language-");
      if (isBlock) {
        const lang = className?.replace("language-", "") ?? "";
        return <CodeBlock lang={lang}>{children}</CodeBlock>;
      }
      return <code className="bg-bg/60 px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
    },
    pre: ({ children }) => <>{children}</>,
    hr: () => <hr className="border-border my-2" />,
    table: ({ children }) => (
      <div className="overflow-x-auto my-1.5">
        <table className="text-xs border-collapse w-full">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
    th: ({ children }) => (
      <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
    img: ({ src, alt }) => {
      // 주소를 잃은 이미지(`urlTransform` 이 지운 스킴)는 빈 칸으로 두지 않는다 —
      // 깨진 아이콘만 남으면 사용자에게 무슨 일이 났는지 단서가 없다(2026-09-20 실측).
      if (typeof src !== "string" || !src) {
        return (
          <span className="my-1 inline-block rounded bg-surface px-2 py-1 text-[11px] text-text-dim">
            {t("chat.imageUnavailable")}
            {alt ? ` — ${alt}` : ""}
          </span>
        );
      }
      const file = chatFileLink(src);
      return (
        <span className="inline-flex flex-col items-start">
          <img
            src={src}
            alt={alt || ""}
            className="max-w-full rounded my-1 max-h-60 object-contain"
          />
          {file && <DownloadLink href={file.href} filename={file.filename} label={download} />}
        </span>
      );
    },
  };
}

// ─── Export ─────────────────────────────────────────────────────────

export default function MarkdownContent({ content }: { content: string }) {
  const t = useT();
  const components = useMemo(() => buildComponents(t), [t]);
  return (
    <div className="markdown-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={chatUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
