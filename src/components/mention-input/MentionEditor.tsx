"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useT } from "@/lib/i18n";
import {
  filterCandidates,
  findMentionQuery,
  reduceDropdown,
  serializeSegments,
  type MentionCandidate,
  type Segment,
} from "./mention-model";

export type MentionEditorHandle = { clear(): void; focus(): void };

type Props = {
  candidates: MentionCandidate[];
  /** 직렬화된 값(`@[이름]` 포맷). 편집기는 DOM 이 정본이고 이 값은 부모가 글자 수 등에 쓴다. */
  value: string;
  onChange: (serialized: string) => void;
  /** 드롭다운이 닫힌 상태의 Enter. */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  accentColor?: string;
};

const CHIP_ATTR = "data-mention-id";

/** 편집기 DOM → 세그먼트. 칩은 `[data-mention-id]` 요소, 나머지는 텍스트다. */
function readSegments(root: HTMLElement): Segment[] {
  const out: Segment[] = [];
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out.push({ kind: "text", text: n.textContent ?? "" });
    } else if (n instanceof HTMLElement && n.hasAttribute(CHIP_ATTR)) {
      out.push({
        kind: "mention",
        id: n.getAttribute(CHIP_ATTR) ?? "",
        name: n.getAttribute("data-mention-name") ?? "",
      });
    } else if (n instanceof HTMLElement && n.tagName === "BR") {
      // contenteditable 이 빈 줄에 넣는 <br> — 무시
    } else {
      out.push({ kind: "text", text: n.textContent ?? "" });
    }
  });
  return out;
}

/**
 * 캐럿 앞 텍스트. 선택 영역이 편집기 안의 텍스트 노드에 있으면 그 노드의 캐럿까지, 아니면
 * (테스트 환경·포커스 없음) 마지막 텍스트 노드 전체를 "캐럿 앞" 으로 본다.
 */
function textBeforeCaret(root: HTMLElement): { node: Text; offset: number; before: string } | null {
  const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
  const anchor = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (
    anchor &&
    anchor.collapsed &&
    anchor.startContainer.nodeType === Node.TEXT_NODE &&
    anchor.startContainer.parentNode === root
  ) {
    const node = anchor.startContainer as Text;
    const offset = anchor.startOffset;
    return { node, offset, before: (node.textContent ?? "").slice(0, offset) };
  }
  const last = root.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    const node = last as Text;
    return { node, offset: node.length, before: node.textContent ?? "" };
  }
  return null;
}

function makeChip(c: MentionCandidate, accent: string): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(CHIP_ATTR, c.id);
  chip.setAttribute("data-mention-name", c.name);
  chip.setAttribute("contenteditable", "false");
  chip.className = `inline-block align-baseline rounded px-1.5 py-0.5 mx-0.5 text-sm font-semibold bg-${accent}-500/25 text-${accent}-200 select-none`;
  chip.textContent = `@${c.name}`;
  return chip;
}

function placeCaretAfter(node: Node) {
  const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
  if (!sel || typeof document.createRange !== "function") return;
  try {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* 선택 API 가 없는 환경 — 캐럿 위치는 브라우저에 맡긴다 */
  }
}

/**
 * `@` 로 NPC 를 지명하는 한 줄 편집기.
 *
 * `<textarea>` 는 글자만 담을 수 있어 "칩" 을 그릴 수 없다. contenteditable 안에
 * `contenteditable="false"` 인 span 을 두면 브라우저가 그것을 한 글자처럼 다룬다 —
 * 백스페이스 한 번에 통째로 지워지고 화살표는 건너뛴다. 전송 시에만 `@[이름]` 으로
 * 직렬화하므로 서버의 `parseAllMentions` 는 손대지 않는다.
 */
const MentionEditor = forwardRef<MentionEditorHandle, Props>(function MentionEditor(
  { candidates, onChange, onSubmit, placeholder, disabled, autoFocus, accentColor = "amber" },
  ref,
) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  // 쿼리가 든 텍스트 노드 — DOM 이라 React 상태가 아니라 ref 로 든다(칩 삽입 시 직접 고친다).
  const queryNodeRef = useRef<Text | null>(null);
  const [index, setIndex] = useState(0);
  const [empty, setEmpty] = useState(true);
  const composingRef = useRef(false);

  const filtered = useMemo(
    () => (query ? filterCandidates(query.query, candidates) : []),
    [query, candidates],
  );
  const open = query !== null;

  const sync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const segs = readSegments(root);
    onChange(serializeSegments(segs));
    setEmpty(segs.every((s) => s.kind === "text" && s.text.length === 0));
    const caret = textBeforeCaret(root);
    const q = caret ? findMentionQuery(caret.before) : null;
    if (q && caret) {
      queryNodeRef.current = caret.node;
      setQuery((prev) => (prev && prev.start === q.start && prev.query === q.query ? prev : q));
      setIndex(0);
    } else {
      queryNodeRef.current = null;
      setQuery(null);
    }
  }, [onChange]);

  const insertChip = useCallback(
    (c: MentionCandidate) => {
      const root = rootRef.current;
      const node = queryNodeRef.current;
      if (!root || !query || !node) return;
      const { start } = query;
      const text = node.textContent ?? "";
      // 캐럿 앞 "@쿼리" 를 잘라내고 그 자리에 칩 + 공백을 넣는다.
      const caret = textBeforeCaret(root);
      const end = caret && caret.node === node ? caret.offset : text.length;
      const before = text.slice(0, start);
      const after = text.slice(end);
      const chip = makeChip(c, accentColor);
      const space = document.createTextNode(after.startsWith(" ") ? after : ` ${after}`);
      node.textContent = before;
      node.after(chip, space);
      if (!before) node.remove();
      placeCaretAfter(chip);
      setQuery(null);
      sync();
    },
    [query, accentColor, sync],
  );

  const clear = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.replaceChildren();
    setQuery(null);
    setEmpty(true);
    onChange("");
  }, [onChange]);

  useImperativeHandle(ref, () => ({ clear, focus: () => rootRef.current?.focus() }), [clear]);

  useEffect(() => {
    if (autoFocus && !disabled) rootRef.current?.focus();
  }, [autoFocus, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation(); // Phaser 가 키를 먹지 않게
      if (e.nativeEvent.isComposing || composingRef.current) return;
      if (open) {
        const next = reduceDropdown({ open: true, index, count: filtered.length }, e.key);
        if (["ArrowDown", "ArrowUp", "Escape", "Enter", "Tab"].includes(e.key)) {
          e.preventDefault();
          if (next.select !== undefined) insertChip(filtered[next.select]);
          else if (!next.open) setQuery(null);
          else setIndex(next.index);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
        return;
      }
      if (e.key === "Backspace") {
        // 캐럿 바로 앞이 칩이면 통째로 지운다(브라우저가 못 하는 환경 대비).
        const sel = window.getSelection?.();
        const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (r && r.collapsed) {
          let prev: Node | null = null;
          if (r.startContainer === rootRef.current)
            prev = rootRef.current.childNodes[r.startOffset - 1] ?? null;
          else if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset === 0)
            prev = r.startContainer.previousSibling;
          if (prev instanceof HTMLElement && prev.hasAttribute(CHIP_ATTR)) {
            e.preventDefault();
            prev.remove();
            sync();
          }
        }
      }
    },
    [open, index, filtered, insertChip, onSubmit, sync],
  );

  return (
    <div className="relative flex-1 min-w-0">
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 mb-1 max-h-48 w-56 overflow-auto rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl z-50"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-gray-500">{t("chat.mentionNoMatch")}</li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertChip(c)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  i === index
                    ? `bg-${accentColor}-500/20 text-white`
                    : "text-gray-200 hover:bg-white/5"
                }`}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      )}
      <div
        ref={rootRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={sync}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => {
          composingRef.current = false;
          sync();
        }}
        onBlur={() => setQuery(null)}
        className={`min-h-[36px] max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words bg-gray-800 text-white px-3 py-2 rounded-lg border focus:outline-none text-sm leading-5 ${
          disabled
            ? "border-gray-700 text-gray-500"
            : `border-gray-600 focus:border-${accentColor}-500`
        } ${empty ? "before:content-[attr(data-placeholder)] before:text-gray-500 before:pointer-events-none" : ""}`}
      />
    </div>
  );
});

export default MentionEditor;
