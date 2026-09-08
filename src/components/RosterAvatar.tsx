"use client";

import { useEffect, useRef } from "react";
import type { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import { compositeCharacter } from "@/lib/sprite-compositor";

/**
 * 명부(플레이어·NPC)에서 쓰는 작은 원형 아바타. `GamePageClient` 안에 있던 것을
 * `NpcRoster` 와 나눠 쓰기 위해 꺼냈다.
 */
export default function RosterAvatar({
  appearance,
  size = 28,
}: {
  appearance: CharacterAppearance | LegacyCharacterAppearance | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !appearance) return;

    const canvas = canvasRef.current;
    const offscreen = document.createElement("canvas");

    compositeCharacter(offscreen, appearance)
      .then(() => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = size;
        canvas.height = size;
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 128, 64, 64, 0, 0, size, size);
      })
      .catch(() => {});
  }, [appearance, size]);

  if (!appearance) {
    return (
      <div
        className="rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-micro font-bold shrink-0"
        style={{ width: size, height: size }}
      >
        ?
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-full bg-surface-raised shrink-0"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}
