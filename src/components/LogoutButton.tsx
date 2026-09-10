"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

export default function LogoutButton() {
  const router = useRouter();
  const t = useT();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth");
  };

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1.5 text-xs text-text-muted hover:text-text bg-surface hover:bg-surface-raised rounded transition-colors"
    >
      {t("common.logout")}
    </button>
  );
}
