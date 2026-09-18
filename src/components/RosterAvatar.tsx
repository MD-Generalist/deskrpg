"use client";

import { useEffect, useState } from "react";
import { resolveOfficeLook } from "@/game/three/office-looks";

/**
 * 명부(플레이어·NPC)에서 쓰는 작은 원형 아바타. `GamePageClient` 안에 있던 것을
 * `NpcRoster` 와 나눠 쓰기 위해 꺼냈다.
 *
 * 룩이 있으면 3D 썸네일, 썸네일이 아직 없으면 룩 이름 첫 글자, 외형이 없으면 "?".
 * 룩 ID 를 모르는 외형은 서버가 정규화하므로 여기서는 "?" 로만 접는다.
 */
export default function RosterAvatar({
  appearance,
  size = 28,
}: {
  appearance: unknown;
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
            style={{ width: size, height: size, objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden="true">{look.name.slice(0, 1)}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-micro font-bold shrink-0"
      style={{ width: size, height: size }}
    >
      ?
    </div>
  );
}
