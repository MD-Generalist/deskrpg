"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as T from "three";
import type { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import { compositeCharacter } from "@/lib/sprite-compositor";
import { createActor, round, cylinder } from "@/game/three/characters";
import { resolveOfficeLook } from "@/game/three/office-looks";
import { spritePalette } from "@/game/three/appearance";
import { disposeTree } from "@/game/three/office-renderer";
import type { MeetingSeatLayout, MeetingTableLayout } from "./layout";
import MeetingSpeechBubble from "./MeetingSpeechBubble";
import { meetingCameraDistance } from "./camera-fit";
import { meetingCaptureOffset } from "./capture-camera";

export interface MeetingSceneSeat extends MeetingSeatLayout {
  name: string;
  appearance: CharacterAppearance | LegacyCharacterAppearance | null;
  isChair: boolean;
  isNpc: boolean;
  isSpeaking: boolean;
  speechPreview: string | null;
  isClickable: boolean;
  onClick?: () => void;
}
export function buildMeetingSceneModel(layout: MeetingTableLayout) {
  return { tableWidth: layout.table.width, seats: layout.seats };
}
interface MeetingTableSceneProps {
  layout: MeetingTableLayout;
  seats: MeetingSceneSeat[];
  availableWidth: number;
}

export default function MeetingTableScene({
  layout,
  seats,
  availableWidth,
}: MeetingTableSceneProps) {
  const host = useRef<HTMLDivElement>(null),
    labelRefs = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef(seats);
  useLayoutEffect(() => {
    latest.current = seats;
  }, [seats]);
  const [fallback, setFallback] = useState(false);
  const arrangement = JSON.stringify(layout.seats);
  const appearances = JSON.stringify(seats.map((seat) => [seat.participantId, seat.appearance]));
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch {
      // WebGL allocation is an external capability check, not derived component state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor("#e8eee0");
    renderer.outputColorSpace = T.SRGBColorSpace;
    element.append(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(34, 1, 0.1, 1000);
    scene.add(new T.HemisphereLight("#fff7e5", "#859577", 2.6));
    const light = new T.DirectionalLight("#fff4d8", 3);
    light.position.set(-5, 12, 8);
    scene.add(light);
    const tableWidth = Math.max(5.6, latest.current.filter((s) => s.side === "top").length * 1.5);
    camera.position.set(0, 10, 12);
    camera.lookAt(0, 0.4, 0);
    round(scene, tableWidth + 5, 0.3, 9, "#d9c7a8", 0, -0.25, 0);
    round(scene, tableWidth, 0.22, 2.8, "#b98e61", 0, 0.84, 0, 0.2);
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        round(scene, 0.15, 0.75, 0.15, "#56715c", x * tableWidth * 0.4, 0.37, z * 1.05);
    const models = new Map<string, ReturnType<typeof createActor>>();
    let disposed = false,
      frame = 0;
    const position = (seat: MeetingSceneSeat) => {
      if (seat.side === "left" || seat.side === "right")
        return new T.Vector3((seat.side === "left" ? -1 : 1) * (tableWidth / 2 + 0.8), 0, 0);
      return new T.Vector3(
        ((seat.x - 50) / 32) * tableWidth * 1.6,
        0,
        seat.side === "top" ? -2 : 2,
      );
    };
    const addActor = (seat: MeetingSceneSeat, i: number, source?: CanvasImageSource) => {
      if (disposed) return;
      const old = models.get(seat.participantId);
      if (old) {
        scene.remove(old.root);
        disposeTree(old.root);
      }
      const palette = spritePalette(source),
        actor = createActor(
          seat.participantId,
          source ? palette.shirt : seat.isChair ? "#67876c" : "#a68c73",
          i % 4,
          palette,
          resolveOfficeLook(seat.appearance),
        );
      actor.root.position.copy(position(seat));
      actor.rig.rotation.y = { top: 0, bottom: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[
        seat.side
      ];
      scene.add(actor.root);
      models.set(seat.participantId, actor);
    };
    latest.current.forEach((seat, i) => {
      const p = position(seat),
        chair = new T.Group();
      chair.position.copy(p);
      scene.add(chair);
      chair.rotation.y = { top: 0, bottom: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[
        seat.side
      ];
      round(chair, 0.7, 0.12, 0.65, "#7e9b7c", 0, 0.4, 0);
      round(chair, 0.7, 0.65, 0.12, "#7e9b7c", 0, 0.72, -0.32);
      cylinder(chair, 0.08, 0.1, 0.4, "#526a57", 0, 0.2, 0);
      addActor(seat, i);
      if (seat.appearance && !resolveOfficeLook(seat.appearance)) {
        const canvas = document.createElement("canvas");
        compositeCharacter(canvas, seat.appearance)
          .then(() => addActor(seat, i, canvas))
          .catch(() => {});
      }
    });
    const captureCamera =
      process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_README_CAPTURE === "1";
    let cameraDistance = 12;
    const pointer = { x: 0, y: 0 };
    const smoothed = { x: 0, y: 0 };
    const movePointer = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      pointer.x = ((event.clientX - box.left) / box.width - 0.5) * 2;
      pointer.y = ((event.clientY - box.top) / box.height - 0.5) * 2;
    };
    const resetPointer = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    if (captureCamera) {
      element.addEventListener("pointermove", movePointer);
      element.addEventListener("pointerleave", resetPointer);
    }
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth,
        height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const distance = meetingCameraDistance(tableWidth, camera.aspect);
      cameraDistance = distance;
      camera.position.set(0, distance * 0.68, distance * 0.8);
      camera.lookAt(0, 0.4, 0);
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const render = (time: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      if (captureCamera) {
        smoothed.x += (pointer.x - smoothed.x) * 0.06;
        smoothed.y += (pointer.y - smoothed.y) * 0.06;
        const offset = meetingCaptureOffset(
          smoothed.x,
          smoothed.y,
          process.env.NODE_ENV,
          process.env.NEXT_PUBLIC_README_CAPTURE,
        );
        camera.position.set(
          Math.sin(offset.yaw) * cameraDistance * 0.8,
          cameraDistance * (0.68 + offset.lift),
          Math.cos(offset.yaw) * cameraDistance * 0.8,
        );
        camera.lookAt(0, 0.4, 0);
      }
      for (const seat of latest.current) {
        const actor = models.get(seat.participantId);
        if (!actor) continue;
        actor.update(time / 1000, false, seat.isSpeaking ? "streaming" : "idle", true);
        const label = labelRefs.current.get(seat.participantId);
        if (!label) continue;
        const p = actor.root.position
          .clone()
          .add(new T.Vector3(0, 1.75, 0))
          .project(camera);
        let labelX = ((p.x + 1) / 2) * element.clientWidth;
        let labelY = ((1 - p.y) / 2) * element.clientHeight;
        const bubble = label.querySelector<HTMLElement>("[data-meeting-speech-bubble]");
        if (bubble) {
          // Labels are translated up by their own height; reserve the full bubble
          // above them so rear seats remain readable in the short mobile scene.
          const halfWidth = bubble.offsetWidth / 2 + 8;
          labelX = Math.max(halfWidth, Math.min(element.clientWidth - halfWidth, labelX));
          labelY = Math.max(label.offsetHeight + bubble.offsetHeight + 16, labelY);
        }
        label.style.left = `${labelX}px`;
        label.style.top = `${labelY}px`;
      }
      renderer.render(scene, camera);
    };
    render(0);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      element.removeEventListener("pointermove", movePointer);
      element.removeEventListener("pointerleave", resetPointer);
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [arrangement, appearances]);
  return (
    <div
      className="relative w-full h-full min-h-0 sm:min-h-[420px] overflow-hidden rounded-2xl border border-border bg-surface-raised"
      style={{ maxWidth: availableWidth || undefined }}
    >
      <div ref={host} className="absolute inset-0" aria-hidden="true" />
      {seats.map((seat) => (
        <div
          key={seat.participantId}
          ref={(node) => {
            if (node) labelRefs.current.set(seat.participantId, node);
            else labelRefs.current.delete(seat.participantId);
          }}
          className={
            fallback ? "relative inline-flex m-4" : "absolute -translate-x-1/2 -translate-y-full"
          }
        >
          <div className="relative flex flex-col items-center">
            <MeetingSpeechBubble
              preview={seat.speechPreview}
              visible={seat.isSpeaking || Boolean(seat.speechPreview)}
              speaking={seat.isSpeaking}
            />
            <button
              type="button"
              onClick={seat.onClick}
              disabled={!seat.isClickable}
              title={seat.name}
              aria-label={seat.name}
              className={`max-w-[48px] sm:max-w-[140px] truncate rounded-lg border px-1 sm:px-3 py-1 text-[9px] sm:text-[11px] font-semibold shadow-sm disabled:cursor-default ${seat.isChair ? "bg-primary text-white border-primary" : seat.isSpeaking ? "bg-surface border-npc text-npc" : "bg-surface border-border text-text"}`}
            >
              {seat.isChair && (
                <span className="mr-1.5" aria-label="Chair">
                  C
                </span>
              )}
              {seat.name}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
