"use client";

import { useState } from "react";

import AppearanceEditor from "@/components/AppearanceEditor";
import { useCharacterAppearance } from "@/hooks/useCharacterAppearance";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import { useT } from "@/lib/i18n";
import type { AppearanceSelection, CharacterAppearance } from "@/lib/lpc-registry";

interface ProfileAppearanceEditorProps {
  gatewayId: string;
  profileId: string;
  /** 프로필이 지금 들고 있는 외형. 없으면 훅의 기본값에서 시작한다. */
  initialAppearance: CharacterAppearance | null;
  onSaved: () => void;
}

/**
 * 프로필 행에서 펼치는 외형 편집기.
 *
 * `useCharacterAppearance` 는 훅이라 행마다 조건부로 부를 수 없다 — 그래서 열려 있는
 * 행에만 마운트되는 자식으로 뽑았다. 배선(`AppearanceEditor` 에 넘기는 props)은
 * `NpcHireModal` 의 custom 모드와 같다.
 */
export default function ProfileAppearanceEditor({
  gatewayId,
  profileId,
  initialAppearance,
  onSaved,
}: ProfileAppearanceEditorProps) {
  const t = useT();
  const {
    bodyType,
    layers,
    activeCategory,
    setActiveCategory,
    handleBodyTypeChange,
    selectItem,
    clearCategory,
    setVariant,
    setSkin,
    isItemCompatible,
    getItemBodyTypes,
    compatibleCount,
    randomize,
    buildAppearance,
  } = useCharacterAppearance(
    initialAppearance?.bodyType ?? "male",
    (initialAppearance?.layers as Record<string, AppearanceSelection | null> | undefined) ??
      undefined,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: buildAppearance() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      onSaved();
    } catch (err) {
      setError(getLocalizedErrorMessage(t, err, "common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      <AppearanceEditor
        bodyType={bodyType}
        layers={layers}
        activeCategory={activeCategory}
        onBodyTypeChange={(bt) => handleBodyTypeChange(bt)}
        onSkinChange={setSkin}
        onSelectItem={selectItem}
        onClearCategory={clearCategory}
        onSetVariant={setVariant}
        onSetActiveCategory={setActiveCategory}
        isItemCompatible={isItemCompatible}
        getItemBodyTypes={getItemBodyTypes}
        compatibleCount={compatibleCount}
        variant="compact"
        presetsSlot={
          <button
            type="button"
            onClick={randomize}
            className="mb-1 w-full rounded bg-indigo-900/60 px-2 py-1 text-center text-xs font-semibold text-indigo-300 hover:bg-indigo-800"
          >
            {t("characters.random")}
          </button>
        }
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {saving ? t("common.loading") : t("gateway.profile.appearanceSave")}
      </button>
    </div>
  );
}
