"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import { Focus, Minus, Plus, Map, Paintbrush } from "lucide-react";
import PhaserGame from "./PhaserGame";
import { EventBus } from "@/game/EventBus";
import { OfficeRenderer, type OfficeTheme } from "@/game/three/office-renderer";
import type { OfficeBridge, EditorSnapshot } from "@/game/three/bridge";
import { OBJECT_TYPE_LIST } from "@/lib/object-types";
import { useLocale } from "@/lib/i18n";
import "@/game/three/office.css";

/** Phaser remains the migration-stage simulation host; only Three.js draws the office. */
export default function ThreeGame(props: ComponentProps<typeof PhaserGame>) {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeRenderer | null>(null),
    bridge = useRef<OfficeBridge | null>(null);
  const [error, setError] = useState(false),
    [editor, setEditor] = useState<EditorSnapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [theme, setTheme] = useState<OfficeTheme>("office");
  const { locale } = useLocale();
  const ko = locale === "ko";
  useLayoutEffect(() => {
    if (!host.current || !labels.current) return;
    let view: OfficeRenderer;
    try {
      view = new OfficeRenderer(host.current, labels.current);
      renderer.current = view;
    } catch (err) {
      console.error("Three.js initialization failed", err);
      // WebGL capability failure is external state discovered only during allocation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(true);
      return;
    }
    const ready = (next: OfficeBridge) => {
      bridge.current = next;
      view.attach(next);
    };
    const speech = ({ senderId }: { senderId: string }) => view.talk(senderId);
    EventBus.on("three:bridge-ready", ready);
    EventBus.on("chat:bubble", speech);
    // Mount ordering: the simulation starts asynchronously, but this also handles a later renderer mount.
    if (bridge.current) view.attach(bridge.current);
    let lastMapKey = "";
    const interval = window.setInterval(() => {
      if (bridge.current) {
        setEditor(bridge.current.editor());
        const key = bridge.current.mapKey();
        if (key !== lastMapKey) {
          lastMapKey = key;
          setSaveStatus("idle");
        }
      }
    }, 250);
    return () => {
      clearInterval(interval);
      EventBus.off("three:bridge-ready", ready);
      EventBus.off("chat:bubble", speech);
      view.dispose();
      renderer.current = null;
      bridge.current = null;
    };
  }, []);
  const edit = (value: Parameters<OfficeBridge["edit"]>[0]) => {
    bridge.current?.edit(value);
    if (bridge.current) setEditor(bridge.current.editor());
  };
  return (
    <div className={`office-presentation ${error ? "office-presentation-fallback" : ""}`}>
      <div className="office-simulation" aria-hidden={!error}>
        <PhaserGame {...props} />
      </div>
      {!error && (
        <>
          <div ref={host} className="office-three-canvas" />
          <div ref={labels} className="office-actor-labels" />
          <div
            className="office-camera-tools"
            aria-label={ko ? "시점과 공간 설정" : "View and space"}
          >
            <button
              type="button"
              onClick={() => renderer.current?.focus()}
              title={ko ? "내 캐릭터 따라가기" : "Follow my character"}
              aria-label={ko ? "내 캐릭터 따라가기" : "Follow my character"}
            >
              <Focus size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.zoom(0.8)}
              aria-label={ko ? "확대" : "Zoom in"}
            >
              <Plus size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.zoom(1.25)}
              aria-label={ko ? "축소" : "Zoom out"}
            >
              <Minus size={17} />
            </button>
            <select
              aria-label={ko ? "공간 분위기" : "Space palette"}
              value={theme}
              onChange={(e) => {
                const next = e.target.value as OfficeTheme;
                setTheme(next);
                renderer.current?.setTheme(next);
              }}
            >
              <option value="office">{ko ? "정원 오피스" : "Garden office"}</option>
              <option value="hanok">{ko ? "한옥 색감" : "Hanok palette"}</option>
              <option value="cafe">{ko ? "카페 색감" : "Café palette"}</option>
            </select>
            {editor?.owner && (
              <button
                type="button"
                aria-pressed={editor.enabled}
                onClick={() => edit({ enabled: !editor.enabled })}
                title={ko ? "맵 편집" : "Edit map"}
                aria-label={ko ? "맵 편집" : "Edit map"}
              >
                <Paintbrush size={17} />
              </button>
            )}
            <Link
              href="/map-editor"
              target="_blank"
              rel="noopener noreferrer"
              title={ko ? "맵 에디터" : "Map editor"}
              aria-label={ko ? "맵 에디터" : "Map editor"}
            >
              <Map size={17} />
            </Link>
          </div>
          <div className="office-movement-hint">
            {ko
              ? "클릭해서 이동 · 방향키 · 우클릭 드래그로 회전"
              : "Click to walk · Arrow keys · Right-drag to orbit"}
          </div>
          {editor?.enabled && (
            <div className="office-edit-tools">
              {editor.tiled ? (
                <Link href="/map-editor" target="_blank" rel="noopener noreferrer">
                  {ko
                    ? "이 맵의 타일은 맵 에디터에서 편집합니다"
                    : "Edit this map’s tiles in the map editor"}
                </Link>
              ) : (
                <>
                  <select
                    aria-label={ko ? "편집 레이어" : "Edit layer"}
                    value={editor.objects ? "objects" : String(editor.layer)}
                    onChange={(e) =>
                      edit({
                        objects: e.target.value === "objects",
                        layer: e.target.value === "1" ? 1 : 0,
                      })
                    }
                  >
                    <option value="0">{ko ? "바닥" : "Floor"}</option>
                    <option value="1">{ko ? "벽" : "Walls"}</option>
                    <option value="objects">{ko ? "가구" : "Furniture"}</option>
                  </select>
                  {editor.objects ? (
                    <select
                      aria-label={ko ? "가구 종류" : "Furniture type"}
                      value={editor.objectType}
                      onChange={(e) => edit({ objectType: e.target.value })}
                    >
                      {OBJECT_TYPE_LIST.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      aria-label={ko ? "타일" : "Tile"}
                      value={editor.tile}
                      onChange={(e) => edit({ tile: Number(e.target.value) })}
                    >
                      {[
                        "Empty",
                        "Floor",
                        "Wall",
                        "Desk",
                        "Chair",
                        "Computer",
                        "Plant",
                        "Door",
                        "Meeting table",
                        "Coffee",
                        "Water cooler",
                        "Bookshelf",
                        "Carpet",
                        "Whiteboard",
                        "Reception",
                        "Cubicle",
                      ].map((tile, i) => (
                        <option key={i} value={i}>
                          {tile}
                        </option>
                      ))}
                    </select>
                  )}
                  <span>
                    {ko ? "클릭: 배치 · 우클릭: 지우기" : "Click: place · Right-click: erase"}
                  </span>
                </>
              )}
              {!editor.tiled && (
                <button
                  type="button"
                  disabled={saveStatus === "saving"}
                  onClick={async () => {
                    setSaveStatus("saving");
                    setSaveStatus((await bridge.current?.save()) ? "saved" : "failed");
                  }}
                >
                  {ko ? "맵 저장" : "Save map"}
                </button>
              )}
              <span role="status">
                {saveStatus === "saved"
                  ? ko
                    ? "저장했습니다"
                    : "Saved"
                  : saveStatus === "failed"
                    ? ko
                      ? "저장 실패. 다시 시도해 주세요."
                      : "Save failed. Please retry."
                    : saveStatus === "saving"
                      ? ko
                        ? "저장 중…"
                        : "Saving…"
                      : ""}
              </span>
              <button type="button" onClick={() => edit({ enabled: false })}>
                {ko ? "편집 종료" : "Done"}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="office-render-error" role="alert">
          {ko
            ? "3D 화면을 시작할 수 없어 기본 화면으로 열었습니다. WebGL 설정을 확인해 주세요."
            : "3D could not start. The standard map is available; check WebGL settings."}
        </p>
      )}
    </div>
  );
}
