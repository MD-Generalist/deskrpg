"use client";
import { AtSign, Briefcase, GitBranch, GitMerge, Link2, MonitorPlay, PenTool } from "lucide-react";

import { brandIconFor } from "../artifact-view-model";

/**
 * lucide 1.x 는 상표 아이콘(Github·Youtube…)을 뺐다. `brandIconFor` 의 이름을 가장 가까운
 * 일반 아이콘으로 옮긴다 — 네트워크(파비콘) 없이 호스트 이름만으로 고른다.
 */
export function LinkIcon({ url, className }: { url: string | null; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (url ? brandIconFor(url) : null) {
    case "github":
      return <GitBranch {...props} />;
    case "gitlab":
      return <GitMerge {...props} />;
    case "youtube":
      return <MonitorPlay {...props} />;
    case "figma":
      return <PenTool {...props} />;
    case "twitter":
      return <AtSign {...props} />;
    case "linkedin":
      return <Briefcase {...props} />;
    default:
      return <Link2 {...props} />;
  }
}
