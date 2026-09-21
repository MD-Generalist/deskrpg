"use client";

import { Star } from "lucide-react";

import { formatStars, REPO_URL } from "@/lib/app-meta";
import { useT } from "@/lib/i18n";

/** 상단 바의 GitHub Star 유도 버튼. 한 번 누르면 강조를 거두고 조용한 버튼으로 남는다. */
export function GrowthStarButton({
  stars,
  clicked,
  onClick,
}: {
  stars: number | null;
  clicked: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const tone = clicked
    ? "bg-surface-raised border border-border text-text-secondary hover:text-text"
    : "bg-primary/80 hover:bg-primary text-white";
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title={t("growth.starTitle")}
      aria-label={t("growth.starTitle")}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-caption font-semibold ${tone}`}
    >
      <Star className="w-3 h-3" fill={clicked ? "none" : "currentColor"} />
      <span className="header-full-label">{t("growth.starLabel")}</span>
      {stars !== null && <span data-testid="growth-star-count">{formatStars(stars)}</span>}
    </a>
  );
}
