"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterAppearance } from "@/lib/lpc-registry";
import { FRAME_WIDTH, FRAME_HEIGHT, WALK_COLS, compositeCharacter } from "@/lib/sprite-compositor";
import { useLocale } from "@/lib/i18n";
import CharacterModelView from "./CharacterModelView";

const DIRECTION_MAP: Record<string, number> = { up: 0, left: 1, down: 2, right: 3 };
interface CharacterPreviewProps {
  appearance: CharacterAppearance;
  scale?: number;
  fps?: number;
  direction?: string;
  active?: boolean;
}
export default function CharacterPreview({
  appearance,
  scale = 3,
  fps = 8,
  direction = "down",
  active = true,
}: CharacterPreviewProps) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null),
    [view, setView] = useState<"3d" | "outfit">("3d");
  const canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef(0);
  const { locale } = useLocale();
  // Key by content: editor builds an appearance object every render.
  const key = JSON.stringify(appearance);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const next = document.createElement("canvas");
    compositeCharacter(next, JSON.parse(key) as CharacterAppearance)
      .then(() => {
        if (!cancelled) setSource(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, active]);
  useEffect(() => {
    if (!active || view !== "outfit" || !source) return;
    const paint = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, FRAME_WIDTH * scale, FRAME_HEIGHT * scale);
      ctx.drawImage(
        source,
        frame.current * FRAME_WIDTH,
        (DIRECTION_MAP[direction] ?? 2) * FRAME_HEIGHT,
        FRAME_WIDTH,
        FRAME_HEIGHT,
        0,
        0,
        FRAME_WIDTH * scale,
        FRAME_HEIGHT * scale,
      );
      frame.current = (frame.current + 1) % WALK_COLS;
    };
    paint();
    const timer = setInterval(paint, 1000 / fps);
    return () => clearInterval(timer);
  }, [active, view, source, scale, fps, direction]);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-2xl border border-border bg-surface-raised overflow-hidden">
        {view === "3d" ? (
          <CharacterModelView
            source={source}
            size={FRAME_WIDTH * scale}
            direction={direction}
            active={active}
            onUnavailable={() => setView("outfit")}
          />
        ) : (
          <canvas ref={canvas} width={FRAME_WIDTH * scale} height={FRAME_HEIGHT * scale} />
        )}
      </div>
      <div className="flex rounded-lg border border-border bg-surface p-1 text-caption">
        <button
          type="button"
          aria-pressed={view === "3d"}
          onClick={() => setView("3d")}
          className={`rounded-md px-3 py-1 ${view === "3d" ? "bg-primary text-white" : "text-text-muted"}`}
        >
          3D
        </button>
        <button
          type="button"
          aria-pressed={view === "outfit"}
          onClick={() => setView("outfit")}
          className={`rounded-md px-3 py-1 ${view === "outfit" ? "bg-primary text-white" : "text-text-muted"}`}
        >
          {locale === "ko" ? "원본 의상" : "Original outfit"}
        </button>
      </div>
    </div>
  );
}
