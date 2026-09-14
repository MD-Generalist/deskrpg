"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import { resolveOfficeLook } from "@/game/three/office-looks";
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
  const look = resolveOfficeLook(appearance);
  const [portrait, setPortrait] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!look) return;
    let cancelled = false;
    void import("./office-roster-thumbnail")
      .then(({ officeRosterThumbnail }) => officeRosterThumbnail(look))
      .then((url) => {
        if (!cancelled && url) setPortrait({ id: look.id, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [look]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !appearance || look) return;
    let cancelled = false;

    const canvas = canvasRef.current;
    const offscreen = document.createElement("canvas");

    compositeCharacter(offscreen, appearance)
      .then(() => {
        if (cancelled) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = size;
        canvas.height = size;
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 128, 64, 64, 0, 0, size, size);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appearance, size, look]);

  if (look) {
    return (
      <div
        className="rounded-full bg-surface-raised shrink-0 overflow-hidden flex items-center justify-center text-micro"
        style={{ width: size, height: size }}
      >
        {portrait?.id === look.id ? (
          <img
            src={portrait.url}
            alt=""
            width={size}
            height={size}
            style={{
              width: size,
              height: size,
              objectFit: "cover",
              transform: "scale(1.8)",
              transformOrigin: "50% 25%",
            }}
          />
        ) : (
          <span aria-hidden="true">{look.name.slice(0, 1)}</span>
        )}
      </div>
    );
  }

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
