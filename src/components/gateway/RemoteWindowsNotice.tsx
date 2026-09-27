"use client";

import { MoreDetails } from "@/components/MoreDetails";
import { useT } from "@/lib/i18n";

export const REMOTE_WINDOWS_UNSUPPORTED = "remote_windows_unsupported";

/** A remote SSH host that answered as Windows. Setup drives remote hosts as Linux only; the way in is a local install. */
export default function RemoteWindowsNotice() {
  const t = useT();
  return (
    <div role="alert" data-remote-windows className="space-y-1 text-sm text-danger">
      <p>{t("hermes.wizard.error.remoteWindows")}</p>
      <MoreDetails className="text-xs">
        <p>{t("hermes.wizard.error.remoteWindowsDetails")}</p>
      </MoreDetails>
    </div>
  );
}
