"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useT } from "@/lib/i18n";
import MyCharacterForm from "./MyCharacterForm";

export default function CharactersPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <CharactersPageInner />
    </Suspense>
  );
}

function CharactersPageInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const joinChannel = searchParams.get("joinChannel");

  return (
    <div className="theme-web workspace-page">
      <div className="workspace-page-inner">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">{t("characters.title")}</h1>
          <div className="flex items-center gap-2"></div>
        </div>

        <MyCharacterForm
          onSaved={() => {
            if (joinChannel) router.push(`/game?channelId=${encodeURIComponent(joinChannel)}`);
          }}
        />
      </div>
    </div>
  );
}
