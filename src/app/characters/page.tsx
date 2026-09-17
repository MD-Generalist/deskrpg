"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { useT } from "@/lib/i18n";
import LogoutButton from "@/components/LogoutButton";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { resolveOfficeLook } from "@/game/three/office-looks";
import CharacterModelView from "@/components/CharacterModelView";

const MAX_CHARACTERS = 5;

interface Character {
  id: string;
  name: string;
  appearance: unknown;
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
  const look = resolveOfficeLook(character.appearance);
  const [unavailable, setUnavailable] = useState(false);

  return (
    <div className="bg-surface p-4 rounded-lg flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer hover:ring-2 hover:ring-primary rounded-xl p-4 w-full bg-bg-deep/60"
      >
        <div
          className="mb-2 mx-auto flex h-48 items-center justify-center overflow-hidden pointer-events-none"
          aria-hidden="true"
        >
          {!look ? (
            <span className="text-4xl font-bold text-text-secondary">?</span>
          ) : unavailable ? (
            <span className="text-sm text-text-muted">3D — {character.name}</span>
          ) : (
            <CharacterModelView
              look={look}
              size={192}
              direction="down"
              active
              walking={false}
              onUnavailable={() => setUnavailable(true)}
            />
          )}
        </div>
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
