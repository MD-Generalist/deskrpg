import * as T from "three";
import type { OfficeLook } from "@/game/three/office-looks";
import { capturePortrait } from "@/game/three/office-look-thumbnail";

const thumbnails = new Map<string, Promise<string | undefined>>();
let queue: Promise<unknown> = Promise.resolve();

/** Serialize captures so a full roster never allocates one WebGL context per person. */
export function officeRosterThumbnail(look: OfficeLook): Promise<string | undefined> {
  const cached = thumbnails.get(look.id);
  if (cached) return cached;
  const job = queue.then(async () => {
    let renderer: T.WebGLRenderer | undefined;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(128, 128);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = T.SRGBColorSpace;
      return (await capturePortrait(renderer, look, new AbortController().signal)) ?? undefined;
    } catch {
      return undefined;
    } finally {
      renderer?.dispose();
      renderer?.forceContextLoss();
    }
  });
  thumbnails.set(look.id, job);
  queue = job;
  return job;
}
