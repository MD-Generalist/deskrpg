"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT, useLocale } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import CharacterPreview from "@/components/CharacterPreview";
import OfficeLookGallery from "@/components/OfficeLookGallery";
import { OFFICE_LOOKS, officeLookAppearance, resolveOfficeLook } from "@/game/three/office-looks";
import {
  normalizeOfficeAppearance,
  type CharacterAppearance,
} from "@/game/three/office-appearance";
import "@/game/three/lookbook.css";

export default function CharacterCreatePage() {
  return (
    <Suspense>
      <CharacterCreatePageInner />
    </Suspense>
  );
}
function CharacterCreatePageInner() {
  const t = useT(),
    { locale } = useLocale(),
    ko = locale === "ko";
  const router = useRouter(),
    searchParams = useSearchParams();
  const joinChannel = searchParams.get("joinChannel"),
    editId = searchParams.get("editId"),
    isEditMode = !!editId;
  const [selectedAppearance, setSelectedAppearance] = useState<CharacterAppearance | null>(() =>
    isEditMode ? null : officeLookAppearance(OFFICE_LOOKS[0].id),
  );
  const [name, setName] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [direction, setDirection] = useState(0),
    [walking, setWalking] = useState(false);
  const directions = ["down", "left", "up", "right"];
  const selected = resolveOfficeLook(selectedAppearance);
  useEffect(() => {
    if (!editId) return;
    const controller = new AbortController();
    fetch(`/api/characters/${editId}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("load");
        const data = await res.json();
        if (!data.character) throw new Error("missing");
        if (controller.signal.aborted) return;
        setName(data.character.name);
        setSelectedAppearance(normalizeOfficeAppearance(data.character.appearance));
        setLoadingEdit(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(t("errors.failedToLoadCharacter"));
        setLoadingEdit(false);
      });
    return () => controller.abort();
  }, [editId, t]);
  const handleSave = async () => {
    if (!selectedAppearance || saving) return;
    if (!name.trim()) {
      setError(t("errors.characterNameRequired"));
      return;
    }
    setSaving(true);
    setError("");

    try {
      if (isEditMode) {
        const res = await fetch(`/api/characters/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), appearance: selectedAppearance }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(getLocalizedErrorMessage(t, data, "errors.failedToUpdateCharacter"));
          setSaving(false);
          return;
        }
        router.push(joinChannel ? `/characters?joinChannel=${joinChannel}` : "/characters");
      } else {
        const res = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), appearance: selectedAppearance }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(getLocalizedErrorMessage(t, data, "errors.failedToCreateCharacter"));
          setSaving(false);
          return;
        }
        const data = await res.json();
        if (joinChannel && data.character?.id) {
          router.push(`/game?channelId=${joinChannel}&characterId=${data.character.id}`);
        } else {
          router.push(joinChannel ? `/characters?joinChannel=${joinChannel}` : "/characters");
        }
      }
    } catch {
      setError(t("common.networkError"));
      setSaving(false);
    }
  };

  if (loadingEdit)
    return (
      <div className="min-h-screen flex items-center justify-center">{t("common.loading")}</div>
    );
  return (
    <div className="lookbook-page">
      <OfficeLookGallery
        selectedId={selected?.id}
        onSelect={(look) => {
          setSelectedAppearance(officeLookAppearance(look.id));
          setError("");
        }}
      />
      <aside className="lookbook-preview" aria-label={ko ? "선택한 캐릭터" : "Selected character"}>
        <div className="lookbook-preview-locale">
          <LocaleSwitcher />
        </div>
        <div className="lookbook-eyebrow">YOUR NEXT CHAPTER</div>
        {selectedAppearance && (
          <CharacterPreview
            appearance={selectedAppearance}
            scale={4.5}
            direction={directions[direction]}
            walking={walking}
          />
        )}
        <div className="lookbook-preview-controls">
          <button
            type="button"
            aria-label={ko ? "왼쪽으로 회전" : "Rotate left"}
            onClick={() => setDirection((direction + 1) % 4)}
          >
            ↶
          </button>
          <button type="button" aria-pressed={walking} onClick={() => setWalking(!walking)}>
            {ko ? (walking ? "걷는 모습" : "서 있는 모습") : walking ? "Walking" : "Standing"}
          </button>
          <button
            type="button"
            aria-label={ko ? "오른쪽으로 회전" : "Rotate right"}
            onClick={() => setDirection((direction + 3) % 4)}
          >
            ↷
          </button>
        </div>
        <h2>
          {selected
            ? ko
              ? selected.name
              : selected.nameEn
            : ko
              ? "나의 기존 캐릭터"
              : "Your existing character"}
        </h2>
        <p className="lookbook-preview-description">
          {selected
            ? ko
              ? selected.subtitle
              : selected.subtitleEn
            : ko
              ? "새로운 룩을 고르기 전까지 기존 외형을 유지합니다."
              : "Your current appearance stays until you choose a new look."}
        </p>
        <div className="lookbook-name">
          <label htmlFor="character-name">
            {ko ? "오피스에서 사용할 이름" : "Your name in the office"}
          </label>
          <input
            id="character-name"
            type="text"
            maxLength={50}
            placeholder={t("characters.namePlaceholderShort")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p className="lookbook-error" role="alert">
            {error}
          </p>
        )}
        <div className="lookbook-save">
          <button type="button" onClick={() => router.back()}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !selectedAppearance || !name.trim()}
          >
            {saving ? t("common.loading") : isEditMode ? t("common.save") : t("characters.create")}
          </button>
        </div>
      </aside>
    </div>
  );
}
