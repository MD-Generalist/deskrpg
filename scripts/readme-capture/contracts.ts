import path from "node:path";

export const SCENES = ["home-commute", "walk-report", "small-talk", "ai-meeting"] as const;
export type CaptureScene = (typeof SCENES)[number];

export const MEDIA_SPEC = {
  recording: { width: 1280, height: 720, fps: 30 },
  gif: {
    width: 960,
    height: 540,
    fps: 12,
    minSeconds: 8,
    maxSeconds: 10,
    maxBytes: 10_000_000,
    loop: "forever",
  },
} as const;

export type VideoProbe = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  loop: "forever" | number;
};

export function capturePaths(root: string, scene: CaptureScene) {
  const artifact = path.join(root, ".artifacts/readme-capture");
  return {
    gif: path.join(root, "public/readme", `deskrpg-${scene}.gif`),
    master: path.join(artifact, "masters", `${scene}.mp4`),
    timing: path.join(artifact, "timings", `${scene}.json`),
  };
}

export function validateProbe(scene: CaptureScene, probe: VideoProbe, bytes: number): void {
  const expected = MEDIA_SPEC.gif;
  if (probe.width !== expected.width || probe.height !== expected.height)
    throw new Error(`${scene}: expected ${expected.width}x${expected.height}`);
  if (Math.abs(probe.fps - expected.fps) > 0.01) throw new Error(`${scene}: expected 12 fps`);
  if (probe.duration < expected.minSeconds || probe.duration > expected.maxSeconds)
    throw new Error(`${scene}: duration ${probe.duration} is outside 8-10 seconds`);
  if (bytes > expected.maxBytes) throw new Error(`${scene}: ${bytes} exceeds 10 MB`);
  if (probe.loop !== expected.loop) throw new Error(`${scene}: expected an infinitely looping GIF`);
}
