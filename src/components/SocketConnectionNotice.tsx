"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type ConnectionEvent = "connect" | "disconnect" | "connect_error";
export type ConnectionSocket = {
  connected: boolean;
  on(event: ConnectionEvent, listener: () => void): unknown;
  off(event: ConnectionEvent, listener: () => void): unknown;
  connect(): unknown;
};

/** Keep connection failures visible until the socket really reconnects, not until a toast expires. */
export default function SocketConnectionNotice({ socket }: { socket: ConnectionSocket | null }) {
  const t = useT();
  const [connection, setConnection] = useState<{
    socket: ConnectionSocket;
    status: "connecting" | "connected" | "disconnected";
  } | null>(null);
  const status =
    connection?.socket === socket
      ? connection?.status
      : socket?.connected
        ? "connected"
        : "connecting";
  useEffect(() => {
    if (!socket) return;
    const connected = () => setConnection({ socket, status: "connected" });
    const disconnected = () => setConnection({ socket, status: "disconnected" });
    socket.on("connect", connected);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", disconnected);
    return () => {
      socket.off("connect", connected);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", disconnected);
    };
  }, [socket]);
  if (!socket || status === "connected") return null;
  return (
    <div
      role={status === "disconnected" ? "alert" : "status"}
      className="fixed left-1/2 top-3 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded border border-border bg-surface-raised px-4 py-3 text-body text-text"
    >
      <span>
        {t(status === "connecting" ? "game.socketReconnecting" : "game.socketOfflinePersistent")}
      </span>
      <button
        type="button"
        className="shrink-0 rounded bg-primary px-3 py-2 text-white"
        onClick={() => {
          setConnection({ socket, status: "connecting" });
          socket.connect();
        }}
      >
        {t("game.socketRetry")}
      </button>
    </div>
  );
}
