"use client";

import { useEffect, useState } from "react";

import { employeesHref } from "@/components/workspace-navigation";
import { useT } from "@/lib/i18n";

import { IMPORT_ANCHOR } from "./HermesProfileImport";

/**
 * Shown on the selected gateway (right after it connects, and later): if its Hermes already has
 * profiles that are not employees, say how many and link to the import section. Says nothing when there are none or the list fails —
 * the import section itself explains a failure.
 */
export default function ImportableProfilesNotice({ gatewayId }: { gatewayId: string }) {
  const t = useT();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/gateways/${gatewayId}/plugin/profiles/importable`);
        const data = await res.json().catch(() => ({}));
        if (alive && res.ok && !data.errorCode && Array.isArray(data.profiles)) {
          setCount(data.profiles.length);
        }
      } catch {
        // No notice is the right answer when the list can't be read.
      }
    })();
    return () => {
      alive = false;
    };
  }, [gatewayId]);

  if (count === 0) return null;
  return (
    <p data-importable-notice={count} className="mt-3 text-sm">
      {t("gateway.profile.import.notice", { count })}{" "}
      <a href={`${employeesHref(gatewayId)}#${IMPORT_ANCHOR}`} className="underline">
        {t("gateway.profile.import.noticeOpen")}
      </a>
    </p>
  );
}
