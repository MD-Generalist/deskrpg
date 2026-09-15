"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Focus, Minus, Plus, Maximize, RotateCcw, RotateCw, Box, LayoutGrid } from "lucide-react";
import PhaserGame from "./PhaserGame";
import { EventBus } from "@/game/EventBus";
import { OfficeRenderer } from "@/game/three/office-renderer";
import type { OfficeBridge } from "@/game/three/bridge";
import { useLocale, useT } from "@/lib/i18n";
import { insideMeetingSpace } from "@/game/meeting-space";
import type { MeetingSpeaker } from "@/game/three/meeting-camera";
import "@/game/three/office.css";

/** Phaser remains the migration-stage simulation host; only Three.js draws the office. */
export default function ThreeGame(props: ComponentProps<typeof PhaserGame>) {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeRenderer | null>(null),
    bridge = useRef<OfficeBridge | null>(null);
  const [error, setError] = useState(false);
  const [meetingCamera, setMeetingCamera] = useState({ active: false, automatic: true });
  const [insideMeeting, setInsideMeeting] = useState(false);
  const [availability, setAvailability] = useState<{ channelId: string; active: boolean } | null>(
    null,
  );
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const t = useT();
  const { locale } = useLocale();
  const ko = locale === "ko";
  useEffect(() => {
    if (!insideMeeting || meetingCamera.active || !props.socket) return;
    const socket = props.socket;
    const channelId = props.channelInitData.channelId;
    const receive = (next: { channelId: string; active: boolean }) => {
      if (next.channelId === channelId && typeof next.active === "boolean") {
        setAvailability(next);
        setAvailabilityError(null);
        clearTimeout(timeout);
      }
    };
    const request = () => {
      if (socket.connected) socket.emit("meeting:availability", { channelId });
    };
    const clear = () => {
      setAvailability(null);
      setAvailabilityError("driver_disconnected");
    };
    const denied = (data: { channelId?: string; action?: string; reason?: string }) => {
      if (data.channelId === channelId && data.action === "meeting:availability") {
        setAvailability(null);
        setAvailabilityError(data.reason ?? "forbidden");
      }
    };
    const timeout = window.setTimeout(() => setAvailabilityError("arrival_timeout"), 10000);
    socket.on("meeting:availability", receive);
    socket.on("connect", request);
    socket.on("disconnect", clear);
    socket.on("channel:access-denied", denied);
    request();
    const timer = window.setInterval(request, 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
      socket.off("meeting:availability", receive);
      socket.off("connect", request);
      socket.off("disconnect", clear);
      socket.off("channel:access-denied", denied);
    };
  }, [insideMeeting, meetingCamera.active, props.socket, props.channelInitData.channelId]);
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
    let cameraActive = false;
    let expectedExit = false;
    view.onMeetingCameraChange = (state) => {
      const interrupted = cameraActive && !state.active && !expectedExit;
      cameraActive = state.active;
      setMeetingCamera(state);
      if (interrupted) EventBus.emit("meeting:join-failed", { reasonCode: "map_unavailable" });
    };
    view.configureMeetingCamera({
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
    const enterMeeting = () => {
      view.setMeetingViewport(0);
      EventBus.emit("meeting:presentation-result", { ok: view.enterMeeting() });
    };
    const exitMeeting = () => {
      expectedExit = true;
      view.exitMeeting();
      expectedExit = false;
    };
    const meetingSpeaker = (speaker: MeetingSpeaker | null) => view.setMeetingSpeaker(speaker);
    const checkInside = window.setInterval(() => {
      const next = bridge.current;
      const space = next?.map().meetingSpace;
      const player = next?.actors().find((actor) => actor.kind === "player");
      setInsideMeeting(
        !!space && !!player && insideMeetingSpace(space.bounds, player.x / 32, player.y / 32),
      );
    }, 250);
    EventBus.on("meeting:presentation-enter", enterMeeting);
    EventBus.on("meeting:presentation-exit", exitMeeting);
    EventBus.on("meeting:speaker", meetingSpeaker);
    EventBus.on("three:bridge-ready", ready);
    EventBus.on("chat:bubble", speech);
    // Mount ordering: the simulation starts asynchronously, but this also handles a later renderer mount.
    if (bridge.current) view.attach(bridge.current);
    return () => {
      EventBus.off("three:bridge-ready", ready);
      EventBus.off("chat:bubble", speech);
      EventBus.off("meeting:presentation-enter", enterMeeting);
      EventBus.off("meeting:presentation-exit", exitMeeting);
      EventBus.off("meeting:speaker", meetingSpeaker);
      window.clearInterval(checkInside);
      expectedExit = true;
      view.dispose();
      renderer.current = null;
      bridge.current = null;
    };
  }, []);
  return (
    <div
      data-meeting={meetingCamera.active}
      className={`office-presentation ${error ? "office-presentation-fallback" : ""}`}
    >
      <div className="office-simulation" aria-hidden={!error}>
        <PhaserGame {...props} />
      </div>
      {!error && (
        <>
          <div ref={host} className="office-three-canvas" />
          <div ref={labels} className="office-actor-labels" />
          <div className="office-camera-tools" aria-label={ko ? "카메라 조작" : "Camera controls"}>
            {meetingCamera.active && (
              <button
                type="button"
                data-meeting-auto-camera
                aria-pressed={meetingCamera.automatic}
                onClick={() => renderer.current?.resumeMeetingAuto()}
              >
                {t(meetingCamera.automatic ? "meeting.cameraAutomatic" : "meeting.cameraResume")}
              </button>
            )}
            <button
              type="button"
              disabled={meetingCamera.active}
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
              disabled={meetingCamera.active}
              title={ko ? "입체 시점" : "Isometric view"}
              aria-label={ko ? "입체 시점" : "Isometric view"}
            >
              <Box size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.setCameraAngle(true)}
              disabled={meetingCamera.active}
              title={ko ? "위에서 보기" : "Top view"}
              aria-label={ko ? "위에서 보기" : "Top view"}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.focus()}
              disabled={meetingCamera.active}
              title={ko ? "내 캐릭터 따라가기" : "Follow my character"}
              aria-label={ko ? "내 캐릭터 따라가기" : "Follow my character"}
            >
              <Focus size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.zoom(0.8)}
              disabled={meetingCamera.active}
              aria-label={ko ? "확대" : "Zoom in"}
            >
              <Plus size={17} />
            </button>
            <button
              type="button"
              onClick={() => renderer.current?.zoom(1.25)}
              disabled={meetingCamera.active}
              aria-label={ko ? "축소" : "Zoom out"}
            >
              <Minus size={17} />
            </button>
          </div>
          <div className="office-movement-hint">
            {meetingCamera.active
              ? t("meeting.rotationHint")
              : ko
                ? "클릭: 걷기 · 드래그: 화면 이동 · 우클릭 드래그: 회전 · 휠: 확대/축소"
                : "Click: walk · Drag: pan · Right-drag: orbit · Scroll: zoom"}
          </div>
          {insideMeeting && !meetingCamera.active && (
            <button
              type="button"
              data-meeting-entry="inside"
              disabled={
                !availabilityError && availability?.channelId !== props.channelInitData.channelId
              }
              className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-primary px-4 py-2 text-white"
              onClick={() => {
                if (availabilityError) {
                  props.socket?.connect();
                  props.socket?.emit("meeting:availability", {
                    channelId: props.channelInitData.channelId,
                  });
                } else EventBus.emit("meeting:entry-intent");
              }}
            >
              {availabilityError
                ? `${t("meeting.entryFailed", { reason: t(`meeting.reason.${availabilityError}`) === `meeting.reason.${availabilityError}` ? availabilityError : t(`meeting.reason.${availabilityError}`) })} · ${t("common.retry")}`
                : t(
                    availability?.channelId !== props.channelInitData.channelId
                      ? "meeting.availabilityLoading"
                      : availability.active
                        ? "meeting.join"
                        : "meeting.prepare",
                  )}
            </button>
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
