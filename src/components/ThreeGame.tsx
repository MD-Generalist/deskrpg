"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Focus, Minus, Plus, Maximize, RotateCcw, RotateCw, Box, LayoutGrid } from "lucide-react";
import PhaserGame from "./PhaserGame";
import { EventBus } from "@/game/EventBus";
import { OfficeRenderer } from "@/game/three/office-renderer";
import type { OfficeBridge } from "@/game/three/bridge";
import { useLocale } from "@/lib/i18n";
import "@/game/three/office.css";

/** Phaser remains the migration-stage simulation host; only Three.js draws the office. */
export default function ThreeGame(props: ComponentProps<typeof PhaserGame>) {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeRenderer | null>(null),
    bridge = useRef<OfficeBridge | null>(null);
  const [error, setError] = useState(false);
  const { locale } = useLocale();
  const ko = locale === "ko";
  useLayoutEffect(() => {
    if (!host.current || !labels.current) return;
    let view: OfficeRenderer;
    try {
      view = new OfficeRenderer(host.current, labels.current);
      renderer.current = view;
      view.onKanbanOpen = () => EventBus.emit("kanban:open");
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
    return () => {
      EventBus.off("three:bridge-ready", ready);
      EventBus.off("chat:bubble", speech);
      view.dispose();
      renderer.current = null;
      bridge.current = null;
    };
  }, []);
  return (
    <div className={`office-presentation ${error ? "office-presentation-fallback" : ""}`}>
      <div className="office-simulation" aria-hidden={!error}>
        <PhaserGame {...props} />
      </div>
      {!error && (
        <>
          <div ref={host} className="office-three-canvas" />
          <div ref={labels} className="office-actor-labels" />
          <div className="office-camera-tools" aria-label={ko ? "카메라 조작" : "Camera controls"}>
            <button
              type="button"
              onClick={() => renderer.current?.showOverview()}
              title={ko ? "전체 보기" : "Overview"}
              aria-label={ko ? "전체 보기" : "Overview"}
            >
              <Maximize size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.rotateCamera(-1)}
              title={ko ? "왼쪽으로 회전" : "Rotate left"}
              aria-label={ko ? "왼쪽으로 회전" : "Rotate left"}
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.rotateCamera(1)}
              title={ko ? "오른쪽으로 회전" : "Rotate right"}
              aria-label={ko ? "오른쪽으로 회전" : "Rotate right"}
            >
              <RotateCw size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.setCameraAngle(false)}
              title={ko ? "입체 시점" : "Isometric view"}
              aria-label={ko ? "입체 시점" : "Isometric view"}
            >
              <Box size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.setCameraAngle(true)}
              title={ko ? "위에서 보기" : "Top view"}
              aria-label={ko ? "위에서 보기" : "Top view"}
            >
              <LayoutGrid size={17} />
            </button>
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
          </div>
          <div className="office-movement-hint">
            {ko
              ? "클릭: 걷기 · 드래그: 화면 이동 · 우클릭 드래그: 회전 · 휠: 확대/축소"
              : "Click: walk · Drag: pan · Right-drag: orbit · Scroll: zoom"}
          </div>
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
