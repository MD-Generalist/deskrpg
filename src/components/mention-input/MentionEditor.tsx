"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { accentClasses, type ChatAccent } from "@/components/chat-accent";
import { MAX_SKILL_CHIPS } from "@/lib/chat/skill-chips";
import { useT } from "@/lib/i18n";
import {
  countSkillChips,
  filterCandidates,
  filterSkillCandidates,
  findMentionQuery,
  findSkillQuery,
  reduceDropdown,
  serializeSegments,
  type MentionCandidate,
  type Segment,
  type SkillCandidate,
} from "./mention-model";

export type MentionEditorHandle = { clear(): void; focus(): void };

/** Why `/` cannot pick a skill here: no single named employee (room), or a plugin without `skill_invocation`. */
export type SkillsBlockedReason = "single_mention" | "plugin_update";

type Props = {
  /** Employees `@` can name. Without it, `@` is a plain character (a DM has no one else to name). */
  candidates?: MentionCandidate[];
  /** Skills `/` can pick, as chips. Without it (and without a blocked reason), `/` is a plain character. */
  skillCandidates?: SkillCandidate[];
  skillsBlockedReason?: SkillsBlockedReason;
  /**
   * Called when `/` opens a skill query, so the parent can load the list on first use. While it has
   * given neither candidates nor a blocked reason, the popup says the list is loading.
   */
  onSkillTrigger?: () => void;
  /** The draft to show when the editor mounts — the DOM is the source of truth after that. */
  initialSegments?: Segment[];
  /** The serialized value (`@[name]` format). The DOM is the editor's source of truth; the parent uses this value for things like character counts. */
  value?: string;
  /** Fires on every edit with the serialized text and the segments (chips included). */
  onChange: (serialized: string, segments: Segment[]) => void;
  /** Enter while the dropdown is closed. */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  accent?: ChatAccent;
};

const CHIP_ATTR = "data-mention-id";
const SKILL_ATTR = "data-skill-name";

const isChip = (n: Node | null): n is HTMLElement =>
  n instanceof HTMLElement && (n.hasAttribute(CHIP_ATTR) || n.hasAttribute(SKILL_ATTR));

/** Editor DOM → segments. A chip is a `[data-mention-id]` or `[data-skill-name]` element; everything else is text. */
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
    } else if (n instanceof HTMLElement && n.hasAttribute(SKILL_ATTR)) {
      out.push({ kind: "skill", name: n.getAttribute(SKILL_ATTR) ?? "" });
    } else if (n instanceof HTMLElement && n.tagName === "BR") {
      // The <br> contenteditable inserts on an empty line — ignore it
    } else {
      out.push({ kind: "text", text: n.textContent ?? "" });
    }
  });
  return out;
}

/**
 * The text before the caret. If the selection is on a text node inside the editor, this is up
 * to that node's caret; otherwise (test environment, no focus) the entire last text node is
 * treated as "before the caret".
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

function makeChip(c: MentionCandidate, chipClass: string): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(CHIP_ATTR, c.id);
  chip.setAttribute("data-mention-name", c.name);
  chip.setAttribute("contenteditable", "false");
  chip.className = `inline-block align-baseline rounded px-1.5 py-0.5 mx-0.5 text-sm font-semibold ${chipClass} select-none`;
  chip.textContent = `@${c.name}`;
  return chip;
}

/** A skill chip reads like the TUI's slash key and is tinted apart from a mention. */
function makeSkillChip(name: string): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute(SKILL_ATTR, name);
  chip.setAttribute("contenteditable", "false");
  chip.className =
    "inline-block align-baseline rounded px-1.5 py-0.5 mx-0.5 text-sm font-semibold bg-primary/15 text-primary select-none";
  chip.textContent = `/${name}`;
  return chip;
}

function segmentNode(s: Segment, chipClass: string): Node {
  if (s.kind === "text") return document.createTextNode(s.text);
  if (s.kind === "mention") return makeChip({ id: s.id, name: s.name }, chipClass);
  return makeSkillChip(s.name);
}

/** Places the caret at an offset inside a text node — it must be "after" the space following a chip, so continued typing lands after that space. */
function placeCaretIn(node: Text, offset: number) {
  const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
  if (!sel || typeof document.createRange !== "function") return;
  try {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* An environment without the selection API — leave the caret position to the browser */
  }
}

const SKILL_NOTE_KEYS = {
  loading: "chat.skills.loading",
  plugin_update: "chat.skills.pluginUpdate",
  single_mention: "chat.skills.needSingleMention",
  limit: "chat.skills.limit",
  empty: "chat.skills.empty",
} as const;

/** Inserts "\n" as text at the caret (or at the end when the editor has no selection). */
function insertLineBreak(root: HTMLElement | null) {
  if (!root) return;
  const br = document.createTextNode("\n");
  const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (range && root.contains(range.startContainer)) {
    range.deleteContents();
    range.insertNode(br);
  } else {
    root.appendChild(br);
  }
  placeCaretIn(br, 1);
}

/**
 * A single-line editor that names an NPC with `@` and picks skills with `/`.
 *
 * A `<textarea>` can only hold characters, so it can't render a "chip". Putting a
 * `contenteditable="false"` span inside a contenteditable makes the browser treat it like a
 * single character — one backspace deletes it whole, and arrow keys skip over it. It's only
 * serialized to `@[name]` at send time, so the server's `parseAllMentions` needs no changes.
 */
const MentionEditor = forwardRef<MentionEditorHandle, Props>(function MentionEditor(
  {
    candidates,
    skillCandidates,
    skillsBlockedReason,
    onSkillTrigger,
    initialSegments,
    onChange,
    onSubmit,
    placeholder,
    disabled,
    autoFocus,
    accent = "npc",
  },
  ref,
) {
  const t = useT();
  const accentTheme = accentClasses(accent);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<{
    kind: "mention" | "skill";
    start: number;
    query: string;
  } | null>(null);
  // Seeded from the saved draft; the DOM itself is filled once on mount (below).
  const [skillCount, setSkillCount] = useState(() => countSkillChips(initialSegments ?? []));
  // The text node holding the query — kept as a ref instead of React state since it's DOM (mutated directly when inserting a chip).
  const queryNodeRef = useRef<Text | null>(null);
  const [index, setIndex] = useState(0);
  const [empty, setEmpty] = useState(() =>
    (initialSegments ?? []).every((s) => s.kind === "text" && s.text.length === 0),
  );
  const composingRef = useRef(false);

  const skillsOn =
    skillCandidates !== undefined ||
    skillsBlockedReason !== undefined ||
    onSkillTrigger !== undefined;
  const [chosenSkills, setChosenSkills] = useState<string[]>(() =>
    (initialSegments ?? []).flatMap((s) => (s.kind === "skill" ? [s.name] : [])),
  );
  const filtered = useMemo(
    () => (query?.kind === "mention" ? filterCandidates(query.query, candidates ?? []) : []),
    [query, candidates],
  );
  const filteredSkills = useMemo(
    () =>
      query?.kind === "skill"
        ? filterSkillCandidates(query.query, skillCandidates ?? []).filter(
            (c) => !chosenSkills.includes(c.name),
          )
        : [],
    [query, skillCandidates, chosenSkills],
  );
  /**
   * What the `/` popup shows instead of a list, when it can't offer one. A note never takes keys:
   * the `/` stays a plain character and Enter still sends.
   */
  const skillNote =
    query?.kind !== "skill"
      ? null
      : skillsBlockedReason === "plugin_update"
        ? "plugin_update"
        : skillsBlockedReason === "single_mention"
          ? "single_mention"
          : skillCount >= MAX_SKILL_CHIPS
            ? "limit"
            : skillCandidates === undefined
              ? "loading"
              : skillCandidates.length === 0
                ? "empty"
                : null;
  const open = query !== null;
  // Rows the keyboard moves through — none while a note shows.
  const rowCount =
    query?.kind === "skill" ? (skillNote ? 0 : filteredSkills.length) : filtered.length;

  /** Reopens or closes the popup from the text before the caret. */
  const detectQuery = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const caret = textBeforeCaret(root);
    const mention = caret && candidates ? findMentionQuery(caret.before) : null;
    const skill = caret && skillsOn ? findSkillQuery(caret.before) : null;
    // Both can't be open at once in practice; the later trigger is the one being typed.
    const q =
      skill && (!mention || skill.start > mention.start)
        ? { kind: "skill" as const, ...skill }
        : mention
          ? { kind: "mention" as const, ...mention }
          : null;
    if (q && caret) {
      queryNodeRef.current = caret.node;
      setQuery((prev) =>
        prev && prev.kind === q.kind && prev.start === q.start && prev.query === q.query ? prev : q,
      );
      setIndex(0);
      if (q.kind === "skill") onSkillTrigger?.();
    } else {
      queryNodeRef.current = null;
      setQuery(null);
    }
  }, [candidates, skillsOn, onSkillTrigger]);

  const sync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const segs = readSegments(root);
    onChange(serializeSegments(segs), segs);
    setEmpty(segs.every((s) => s.kind === "text" && s.text.length === 0));
    setSkillCount(countSkillChips(segs));
    setChosenSkills(segs.flatMap((s) => (s.kind === "skill" ? [s.name] : [])));
    detectQuery();
  }, [onChange, detectQuery]);

  /** Replaces the open "@query" or "/query" before the caret with a chip and a space. */
  const replaceQueryWith = useCallback(
    (chip: HTMLElement) => {
      const root = rootRef.current;
      const node = queryNodeRef.current;
      if (!root || !query || !node) return;
      const { start } = query;
      const text = node.textContent ?? "";
      const caret = textBeforeCaret(root);
      const end = caret && caret.node === node ? caret.offset : text.length;
      const before = text.slice(0, start);
      const after = text.slice(end);
      const space = document.createTextNode(after.startsWith(" ") ? after : ` ${after}`);
      node.textContent = before;
      node.after(chip, space);
      if (!before) node.remove();
      placeCaretIn(space, 1);
      setQuery(null);
      sync();
    },
    [query, sync],
  );

  const insertChip = useCallback(
    (c: MentionCandidate) => replaceQueryWith(makeChip(c, accentTheme.chip)),
    [replaceQueryWith, accentTheme.chip],
  );

  const insertSkill = useCallback(
    (c: SkillCandidate) => replaceQueryWith(makeSkillChip(c.name)),
    [replaceQueryWith],
  );

  // Show the saved draft (chips included) once, when the editor mounts.
  const seededRef = useRef(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || seededRef.current) return;
    seededRef.current = true;
    if (!initialSegments?.length) return;
    root.replaceChildren(...initialSegments.map((s) => segmentNode(s, accentTheme.chip)));
    const last = root.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) placeCaretIn(last as Text, (last as Text).length);
  }, [initialSegments, accentTheme.chip]);

  const clear = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.replaceChildren();
    setQuery(null);
    setEmpty(true);
    setSkillCount(0);
    setChosenSkills([]);
    onChange("", []);
  }, [onChange]);

  useImperativeHandle(ref, () => ({ clear, focus: () => rootRef.current?.focus() }), [clear]);

  useEffect(() => {
    if (autoFocus && !disabled) rootRef.current?.focus();
  }, [autoFocus, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation(); // so simulation doesn't swallow the key
      if (e.nativeEvent.isComposing || composingRef.current) return;
      if (open && e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
      if (open && !skillNote) {
        const next = reduceDropdown({ open: true, index, count: rowCount }, e.key);
        if (["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) {
          e.preventDefault();
          if (next.select !== undefined) {
            if (query?.kind === "skill") insertSkill(filteredSkills[next.select]);
            else insertChip(filtered[next.select]);
          } else setIndex(next.index);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        // A line break as text — the browser's own would add <div>/<br> nodes the segments can't read.
        e.preventDefault();
        insertLineBreak(rootRef.current);
        sync();
        return;
      }
      if (e.key === "Backspace") {
        // If a chip sits right before the caret, delete it whole (for environments where the browser can't).
        const sel = window.getSelection?.();
        const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (r && r.collapsed) {
          let prev: Node | null = null;
          if (r.startContainer === rootRef.current)
            prev = rootRef.current.childNodes[r.startOffset - 1] ?? null;
          else if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset === 0)
            prev = r.startContainer.previousSibling;
          if (isChip(prev)) {
            e.preventDefault();
            prev.remove();
            sync();
          }
        }
      }
    },
    [
      open,
      skillNote,
      index,
      rowCount,
      query,
      filtered,
      filteredSkills,
      insertChip,
      insertSkill,
      onSubmit,
      sync,
    ],
  );

  return (
    <div className="relative flex-1 min-w-0">
      {open && query?.kind === "skill" && skillNote && (
        <p
          role="note"
          data-skill-note={skillNote}
          className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-dim shadow-xl z-50"
        >
          {t(SKILL_NOTE_KEYS[skillNote])}
        </p>
      )}
      {open && query?.kind === "skill" && !skillNote && (
        <ul
          role="listbox"
          data-skill-list=""
          className="absolute bottom-full left-0 mb-1 max-h-48 w-64 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-xl z-50"
        >
          {filteredSkills.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-text-dim">{t("chat.skills.noMatch")}</li>
          ) : (
            filteredSkills.map((c, i) => (
              <li
                key={c.name}
                role="option"
                aria-selected={i === index}
                data-skill-option={c.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertSkill(c)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  i === index
                    ? `${accentTheme.option} font-medium`
                    : "text-text hover:bg-surface-raised"
                }`}
              >
                <span className="block">/{c.name}</span>
                {c.description && (
                  <span className="block truncate text-xs text-text-dim">{c.description}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
      {open && query?.kind === "mention" && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 mb-1 max-h-48 w-56 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-xl z-50"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-text-dim">{t("chat.mentionNoMatch")}</li>
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
                    ? `${accentTheme.option} font-medium`
                    : "text-text hover:bg-surface-raised"
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
        className={`min-h-[36px] max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words bg-surface text-text px-3 py-2 rounded-lg border focus:outline-none text-sm leading-5 ${
          disabled ? "border-border text-text-dim" : `border-border ${accentTheme.focusBorder}`
        } ${empty ? "before:content-[attr(data-placeholder)] before:text-text-dim before:pointer-events-none" : ""}`}
      />
    </div>
  );
});

export default MentionEditor;
