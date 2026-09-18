"use client";

export default function MediaViewer({ kind, src }: { kind: "audio" | "video"; src: string }) {
  if (kind === "audio") return <audio controls src={src} className="w-full" />;
  return <video controls src={src} className="max-w-full max-h-[70dvh] mx-auto rounded-md" />;
}
