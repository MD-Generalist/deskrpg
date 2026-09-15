import * as T from "three";
import type { MeetingSpace } from "../meeting-space";
import type { ActorSnapshot } from "./bridge";
export type MeetingSpeaker = {
  kind: "user" | "npc";
  id: string;
  utteranceId: string;
  phase?: "speaking" | "thinking" | "working";
};
export type MeetingCameraControls = {
  target: T.Vector3;
  enablePan: boolean;
  enableZoom: boolean;
  enableDamping: boolean;
  minDistance: number;
  maxDistance: number;
  mouseButtons: { LEFT?: T.MOUSE | null; MIDDLE?: T.MOUSE | null; RIGHT?: T.MOUSE | null };
  touches: { ONE?: T.TOUCH | null; TWO?: T.TOUCH | null };
};
export type MeetingCameraOptions = {
  reducedMotion?: boolean;
  roomTransitionSeconds?: number;
  speakerTransitionSeconds?: number;
  maxSpeakerZoom?: number;
};
export class MeetingCamera {
  automatic = true;
  private space: MeetingSpace | null = null;
  private speaker: MeetingSpeaker | null = null;
  private resolvedKey = "";
  private width = 1;
  private height = 1;
  private right = 0;
  private elapsed = 0;
  private duration = 0;
  private fromTarget = new T.Vector3();
  private fromOrbit = new T.Spherical();
  private toTarget = new T.Vector3();
  private toOrbit = new T.Spherical();
  private dirty = false;
  private saved: {
    position: T.Vector3;
    target: T.Vector3;
    far: number;
    enablePan: boolean;
    enableZoom: boolean;
    enableDamping: boolean;
    minDistance: number;
    maxDistance: number;
    mouseButtons: MeetingCameraControls["mouseButtons"];
    touches: MeetingCameraControls["touches"];
  } | null = null;
  constructor(
    private camera: T.PerspectiveCamera,
    private controls: MeetingCameraControls,
    private options: MeetingCameraOptions = {},
  ) {}
  get active() {
    return this.space !== null;
  }
  configure(options: MeetingCameraOptions) {
    this.options = { ...this.options, ...options };
    this.dirty = true;
  }
  setViewport(width: number, height: number, right = 0) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.right = Math.max(0, Math.min(this.width - 1, right));
    if (this.active) {
      this.projection();
      // Projection changes immediately on resize; keep the room visible even before RAF.
      const offset = this.camera.position.clone().sub(this.controls.target);
      const distance = Math.max(offset.length(), this.fitDistance(this.controls.target));
      if (!offset.lengthSq()) offset.set(0.45, 0.9, 1);
      this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
      this.camera.far = Math.max(250, distance * 4);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      this.dirty = true;
    }
  }
  private projection() {
    // Render the full canvas, with its optical center inside the unobscured left viewport.
    this.camera.setViewOffset(this.width - this.right, this.height, 0, 0, this.width, this.height);
  }
  enter(space: MeetingSpace) {
    if (this.space?.id === space.id && this.space.version === space.version) return;
    this.exit();
    const c = this.controls;
    this.saved = {
      position: this.camera.position.clone(),
      target: c.target.clone(),
      far: this.camera.far,
      enablePan: c.enablePan,
      enableZoom: c.enableZoom,
      enableDamping: c.enableDamping,
      minDistance: c.minDistance,
      maxDistance: c.maxDistance,
      mouseButtons: { ...c.mouseButtons },
      touches: { ...c.touches },
    };
    this.space = space;
    this.automatic = true;
    c.enablePan = false;
    c.enableZoom = false;
    c.enableDamping = false;
    c.minDistance = 0.1;
    c.maxDistance = Infinity;
    c.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.ROTATE, RIGHT: T.MOUSE.ROTATE };
    c.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
    this.resolvedKey = "";
    this.dirty = true;
    this.projection();
  }
  exit() {
    if (this.saved) {
      const { position, target, far, ...controls } = this.saved;
      Object.assign(this.controls, controls);
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.camera.far = far;
      this.camera.clearViewOffset();
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(target);
    }
    this.saved = null;
    this.space = null;
    this.speaker = null;
    this.resolvedKey = "";
    this.automatic = true;
  }
  dispose() {
    this.exit();
  }
  update(delta: number, actors: ActorSnapshot[]) {
    if (!this.space) return;
    const b = this.space.bounds;
    const speech =
      this.speaker && (!this.speaker.phase || this.speaker.phase === "speaking")
        ? this.speaker
        : null;
    const actor =
      speech &&
      actors.find((a) =>
        speech.kind === "npc"
          ? a.kind === "npc" && a.id === speech.id
          : a.kind !== "npc" && a.userId === speech.id,
      );
    const inRoom =
      actor &&
      actor.x / 32 >= b.x &&
      actor.x / 32 <= b.x + b.width &&
      actor.y / 32 >= b.y &&
      actor.y / 32 <= b.y + b.height;
    const speaker = inRoom ? actor : undefined;
    const key = speaker
      ? `${this.speaker!.kind}:${speaker.id}:${this.speaker!.utteranceId}`
      : "overview";
    if (!this.automatic) {
      if (this.dirty) {
        const orbit = new T.Spherical().setFromVector3(
          this.camera.position.clone().sub(this.controls.target),
        );
        orbit.radius = Math.max(orbit.radius, this.fitDistance(this.controls.target));
        this.camera.position
          .copy(this.controls.target)
          .add(new T.Vector3().setFromSpherical(orbit));
        this.camera.lookAt(this.controls.target);
        this.dirty = false;
      }
      return;
    }
    if (this.dirty || this.resolvedKey !== key) {
      const first = this.resolvedKey === "";
      this.resolvedKey = key;
      this.dirty = false;
      this.fromTarget.copy(this.controls.target);
      this.fromOrbit.setFromVector3(this.camera.position.clone().sub(this.controls.target));
      this.toTarget.set(b.x + b.width / 2, 1.25, b.y + b.height / 2);
      if (speaker) this.toTarget.lerp(new T.Vector3(speaker.x / 32, 1.25, speaker.y / 32), 0.35);
      this.toOrbit.copy(this.fromOrbit);
      // Absolute room-relative heading, never an accumulated turn per speech update.
      const heading =
        Math.PI / 5 +
        (speaker
          ? Math.atan2(
              speaker.x / 32 - (b.x + b.width / 2),
              speaker.y / 32 - (b.y + b.height / 2),
            ) * 0.12
          : 0);
      this.toOrbit.theta =
        this.fromOrbit.theta +
        Math.atan2(
          Math.sin(heading - this.fromOrbit.theta),
          Math.cos(heading - this.fromOrbit.theta),
        );
      this.toOrbit.phi = Math.PI / 3.5;
      const zoom = Math.max(1, Math.min(1.35, this.options.maxSpeakerZoom ?? 1.35));
      this.toOrbit.radius = this.fitDistance(this.toTarget) * (speaker ? 1 : zoom);
      this.elapsed = 0;
      this.duration = Math.max(
        0,
        first
          ? (this.options.roomTransitionSeconds ?? 0.8)
          : (this.options.speakerTransitionSeconds ?? 0.6),
      );
      this.camera.far = Math.max(250, this.toOrbit.radius * 4);
      this.camera.updateProjectionMatrix();
    }
    this.elapsed += Math.max(0, delta);
    const t =
      this.options.reducedMotion || this.duration === 0
        ? 1
        : Math.min(1, this.elapsed / this.duration);
    const ease = t * t * (3 - 2 * t);
    this.controls.target.lerpVectors(this.fromTarget, this.toTarget, ease);
    const orbit = new T.Spherical(
      T.MathUtils.lerp(this.fromOrbit.radius, this.toOrbit.radius, ease),
      T.MathUtils.lerp(this.fromOrbit.phi, this.toOrbit.phi, ease),
      T.MathUtils.lerp(this.fromOrbit.theta, this.toOrbit.theta, ease),
    );
    this.camera.position.copy(this.controls.target).add(new T.Vector3().setFromSpherical(orbit));
    this.camera.lookAt(this.controls.target);
  }
  private fitDistance(target: T.Vector3) {
    const b = this.space!.bounds;
    // A bounding sphere guarantees furniture/participant clearance at every rotation angle.
    let radius = 0;
    for (const x of [b.x, b.x + b.width])
      for (const z of [b.y, b.y + b.height])
        for (const y of [0, 2.5])
          radius = Math.max(radius, target.distanceTo(new T.Vector3(x, y, z)));
    const vertical = T.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan((Math.tan(vertical) * (this.width - this.right)) / this.height);
    return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.08;
  }
  setSpeaker(speaker: MeetingSpeaker | null) {
    this.speaker = speaker;
  }
  manualRotate() {
    if (this.active) this.automatic = false;
  }
  resumeAuto() {
    if (this.active) {
      this.automatic = true;
      this.dirty = true;
    }
  }
}
