"use client";

import type { ReactNode } from "react";

import { useT } from "@/lib/i18n";

/**
 * Folded technical details under a plain-language notice. The notice says what happens and the one
 * thing to do; setting names, keys and what a command changes live here for whoever needs them.
 */
export function MoreDetails({ children, className }: { children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <details data-more-details className={`text-text-dim ${className ?? ""}`}>
      <summary className="cursor-pointer select-none text-text-muted hover:text-text">
        {t("common.moreDetails")}
      </summary>
      <div className="mt-1 space-y-1">{children}</div>
    </details>
  );
}
