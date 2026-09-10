"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import { useT } from "@/lib/i18n";
import LogoutButton from "@/components/LogoutButton";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { FRAME_WIDTH, FRAME_HEIGHT, compositeCharacter } from "@/lib/sprite-compositor";

const PREVIEW_SCALE = 2;
const DIRECTION = 2; // facing down
const MAX_CHARACTERS = 5;

interface Character {
  id: string;
  name: string;
  appearance: CharacterAppearance | LegacyCharacterAppearance;
  createdAt: string;
}

function CharacterCard({
  character,
  onClick,
  onEdit,
  onDelete,
}: {
  character: Character;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const hidden = hiddenCanvasRef.current;
    const preview = previewCanvasRef.current;
    if (!hidden || !preview) return;

    compositeCharacter(hidden, character.appearance)
      .then(() => {
        const ctx = preview.getContext("2d");
        if (!ctx) return;

        preview.width = FRAME_WIDTH * PREVIEW_SCALE;
        preview.height = FRAME_HEIGHT * PREVIEW_SCALE;
        ctx.imageSmoothingEnabled = false;

        ctx.clearRect(0, 0, preview.width, preview.height);
        ctx.drawImage(
          hidden,
          0,
          DIRECTION * FRAME_HEIGHT,
          FRAME_WIDTH,
          FRAME_HEIGHT,
          0,
          0,
          FRAME_WIDTH * PREVIEW_SCALE,
          FRAME_HEIGHT * PREVIEW_SCALE,
        );
      })
      .catch(() => {});
  }, [character.appearance]);

  return (
    <div className="bg-surface p-4 rounded-lg flex flex-col items-center">
      <canvas ref={hiddenCanvasRef} className="hidden" />
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer hover:ring-2 hover:ring-primary rounded-xl p-4 w-full bg-bg-deep/60"
      >
        <canvas
          ref={previewCanvasRef}
          width={FRAME_WIDTH * PREVIEW_SCALE}
          height={FRAME_HEIGHT * PREVIEW_SCALE}
          className="mb-2 mx-auto"
        />
        <span className="block font-bold text-center">{character.name}</span>
      </button>
      <div className="mt-2 flex gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="px-3 py-1 bg-surface-raised hover:bg-border rounded text-xs text-text-secondary"
        >
          {t("common.edit")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-3 py-1 bg-danger-bg hover:bg-danger-bg/80 rounded text-xs text-red-700"
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

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
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/characters")
      .then((res) => res.json())
      .then((data) => {
        setCharacters(data.characters || []);
        setLoading(false);
      });
  }, []);

  // When user selects a character: if joinChannel is set, go directly to game
  const handleSelectCharacter = (charId: string) => {
    if (joinChannel) {
      router.push(`/game?channelId=${joinChannel}&characterId=${charId}`);
    } else {
      router.push(`/channels?characterId=${charId}`);
    }
  };

  const handleDeleteCharacter = async (charId: string, charName: string) => {
    if (!confirm(t("characters.deleteConfirm").replace("{name}", charName))) return;
    const res = await fetch(`/api/characters/${charId}`, { method: "DELETE" });
    if (res.ok) {
      const remaining = characters.filter((c) => c.id !== charId);
      setCharacters(remaining);
      if (remaining.length === 0) {
        router.push(createUrl);
      }
    }
  };

  const handleEditCharacter = (charId: string) => {
    const params = new URLSearchParams();
    params.set("editId", charId);
    if (joinChannel) params.set("joinChannel", joinChannel);
    router.push(`/characters/create?${params.toString()}`);
  };

  // Preserve joinChannel param in create link
  const createUrl = joinChannel
    ? `/characters/create?joinChannel=${joinChannel}`
    : "/characters/create";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t("characters.title")}</h1>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <LogoutButton />
        </div>
      </div>

      {characters.length < MAX_CHARACTERS ? (
        <Link
          href={createUrl}
          className="inline-block mb-6 px-4 py-2 bg-primary hover:bg-primary-hover rounded font-semibold text-white"
        >
          {t("characters.createNew")}
        </Link>
      ) : (
        <p className="mb-6 text-text-muted">{t("characters.maxReached")}</p>
      )}

      {characters.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-text-muted mb-4">{t("characters.noCharacters")}</p>
          <p className="text-text-dim">{t("characters.noCharactersHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {characters.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onClick={() => handleSelectCharacter(char.id)}
              onEdit={() => handleEditCharacter(char.id)}
              onDelete={() => handleDeleteCharacter(char.id, char.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
