import * as T from "three";
import { round, sphere } from "./primitives";
export { round, sphere, cylinder } from "./primitives";
import { createOfficeActor } from "./office-actor";
import type { OfficeLook } from "./office-looks";
const mat = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.8 });
export type ActorPhase =
  "idle" | "walking" | "seated" | "queued" | "thinking" | "streaming" | "done";
export function createActor(
  id: string,
  color: string,
  index: number,
  palette?: { skin: string; hair: string; legs: string },
  look?: OfficeLook,
) {
  if (look) return createOfficeActor(id, look, index);
  const root = new T.Group(),
    rig = new T.Group();
  root.add(rig);
  root.userData.actorId = id;
  const skin = palette?.skin || ["#e8b991", "#f1c9a4", "#d4a17c", "#edc6a6"][index % 4],
    hair = palette?.hair || ["#51382d", "#644536", "#283c40", "#4d323c"][index % 4];
  const torso = round(rig, 0.48, 0.5, 0.32, color, 0, 0.8, 0, 0.1);
  round(rig, 0.11, 0.26, 0.025, "#efe5ce", 0, 0.86, 0.172, 0.01);
  const head = new T.Group();
  head.position.y = 1.32;
  rig.add(head);
  sphere(head, 0.32, skin, 0, 0, 0, 1, 1.06, 0.94);
  sphere(head, 0.326, hair, 0, 0.125, -0.07, 1.03, 0.75, 1);
  round(head, 0.4, 0.12, 0.14, hair, -0.035, 0.22, 0.17, 0.045).rotation.z = -0.15;
  for (const s of [-1, 1]) {
    sphere(head, 0.065, skin, s * 0.3, -0.02, 0);
    sphere(head, 0.025, "#25312b", s * 0.105, 0.01, 0.282, 1, 1.25, 0.5);
    sphere(head, 0.03, "#d99180", s * 0.19, -0.075, 0.25, 1.3, 0.5, 0.3);
  }
  sphere(head, 0.048, skin, 0, -0.055, 0.3, 1, 0.8, 0.65);
  round(head, 0.07, 0.014, 0.018, "#985f51", 0, -0.14, 0.289, 0.005);
  if (index === 2) {
    for (const s of [-1, 1]) {
      const glass = new T.Mesh(new T.TorusGeometry(0.072, 0.012, 5, 16), mat("#283e3c"));
      glass.position.set(s * 0.105, 0.01, 0.305);
      head.add(glass);
    }
    round(head, 0.065, 0.015, 0.015, "#283e3c", 0, 0.01, 0.3, 0.004);
  }
  if (index === 3) {
    sphere(head, 0.14, hair, 0, 0.1, -0.29);
    sphere(head, 0.11, hair, 0, -0.12, -0.3);
  }
  const arms: T.Group[] = [],
    legs: T.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(s * 0.3, 0.95, 0);
    rig.add(arm);
    round(arm, 0.16, 0.29, 0.18, color, 0, -0.12, 0, 0.06);
    sphere(arm, 0.085, skin, 0, -0.31, 0.015);
    arms.push(arm);
    const leg = new T.Group();
    leg.position.set(s * 0.13, 0.56, 0);
    rig.add(leg);
    round(leg, 0.18, 0.32, 0.19, palette?.legs || "#344941", 0, -0.14, 0, 0.045);
    round(leg, 0.2, 0.12, 0.31, "#efe7d6", 0, -0.34, 0.065, 0.045);
    legs.push(leg);
  }
  const ring = new T.Mesh(
    new T.RingGeometry(0.36, 0.41, 48),
    new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: T.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  root.add(ring);
  return {
    id,
    root,
    rig,
    ring,
    phase: "idle" as ActorPhase,
    seated: false,
    update(t: number, walking: boolean, phase: ActorPhase, seated: boolean) {
      const sit = seated && !walking;
      rig.position.y = sit
        ? 0.04
        : walking
          ? -0.14 + Math.abs(Math.sin(t * 9)) * 0.035
          : -0.14 + Math.sin(t * 2.3 + index) * 0.012;
      torso.rotation.z = phase === "thinking" ? Math.sin(t * 1.4) * 0.035 : 0;
      head.rotation.x = phase === "thinking" ? 0.12 : 0;
      head.rotation.z = phase === "thinking" ? 0.12 : Math.sin(t * 1.8 + index) * 0.025;
      arms.forEach((a, i) => {
        a.rotation.x = walking
          ? Math.sin(t * 9 + i * Math.PI) * 0.55
          : phase === "thinking" && i === 0
            ? -1.7
            : phase === "streaming"
              ? -0.45 + Math.sin(t * 4 + i) * 0.2
              : sit
                ? -0.5
                : 0;
        a.rotation.z = phase === "streaming" ? Math.sin(t * 3 + i) * 0.15 : 0;
      });
      legs.forEach(
        (l, i) =>
          (l.rotation.x = walking ? Math.sin(t * 9 + i * Math.PI) * 0.5 : sit ? -Math.PI / 2 : 0),
      );
      ring.material.opacity = phase === "streaming" ? 0.55 + Math.sin(t * 4) * 0.25 : 0.3;
    },
  };
}
