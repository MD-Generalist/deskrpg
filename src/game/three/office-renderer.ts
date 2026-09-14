import { furnitureOffset } from "./executive-lounge-layout";
import { attachFurnitureAsset, attachSceneAsset } from "./furniture-asset";
import { disposeTree } from "./dispose-tree";
export { disposeTree } from "./dispose-tree";
import { addExecutiveArchitecture } from "./executive-architecture";
import { adaptRenderScale } from "./render-scale";
import { layoutActorLabels, bubbleWidthFor, type ActorLabelAnchor } from "./label-layout";
import { FrameBenchmark, type BenchmarkReport, type FrameMetrics } from "./frame-benchmark";
import { showPerformanceHud } from "./performance-hud";
import { turnToward } from "../navigation";
import { addOfficePerimeter } from "./office-perimeter";
import { buildRoomFurniture } from "./room-furniture";
import { addRoomPartition, addRoomTJunction, addOfficeRoomSurfaces } from "./room-architecture";
import { batchStaticFurniture, batchCoplanarGlass } from "./static-batching";
import { officeFinish } from "./office-finishes";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { officeLighting, shadowExtent } from "./office-lighting";
import { detailSurfaces, surfaceTexture } from "./surface-detail";
import { resolveSeat, seatAt, sofaSeats, furnitureSeats, type Seat } from "./seating";
import { PointerGesture } from "./pointer-gesture";
import { pickFurnitureSeat } from "./seat-picking";
import { resolveOfficeLook } from "./office-looks";
import { isOfficeEnvironmentId } from "./office-environment-theme";
import * as T from "three";
import { spritePalette } from "./appearance";
import { addOfficeDetails } from "./office-details";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createActor, round, sphere, cylinder } from "./characters";
import {
  actorIndicator,
  actorPresentationPhase,
  speechActorId,
  pixelToWorld,
  overviewDistance,
  worldToPixel,
  type ActorSnapshot,
  type OfficeBridge,
  type MapSnapshot,
} from "./bridge";
import { getObjectDimensions, TILE_ID_TO_OBJECT, type MapObject } from "../../lib/object-types";

/** 이름표 옆 글리프 — 대화 응답 셋 + 작업 중(R27). `actorIndicator` 가 우선순위를 정한다. */
const INDICATOR_GLYPH: Record<NonNullable<ReturnType<typeof actorIndicator>> | "none", string> = {
  queued: "⏳",
  thinking: "💭",
  streaming: "💬",
  working: "🛠️",
  none: "",
};

const palettes = {
  office: { floor: "#e3d0aa", wall: "#dae2d2", wood: "#b48a60", outside: "#e9eee2" },
  hanok: { floor: "#ddc6a2", wall: "#eee5cc", wood: "#765644", outside: "#e2e9da" },
  cafe: { floor: "#cbb49b", wall: "#dcc4ae", wood: "#895c43", outside: "#f1e5d8" },
};
export type OfficeTheme = keyof typeof palettes;
const environmentPalettes = {
  trading: { floor: "#e3d0aa", wall: "#dae2d2", wood: "#b48a60", outside: "#e9eee2" },
  agency: { floor: "#ecd2c1", wall: "#e5b5a3", wood: "#b77962", outside: "#f3e7df" },
  tech: { floor: "#d5e0db", wall: "#b1cbc6", wood: "#719389", outside: "#e5efed" },
  executive: { floor: "#d9cbb5", wall: "#62422d", wood: "#65584b", outside: "#f1eadf" },
  publishing: { floor: "#ecdfbf", wall: "#dfd0ab", wood: "#a17b4f", outside: "#f2ecda" },
};

type RenderedActor = {
  previous?: { x: number; z: number; time: number; direction: string };
  yaw?: number;
  model: ReturnType<typeof createActor>;
  label: HTMLButtonElement;
  name: HTMLSpanElement;
  bubble: HTMLSpanElement;
  labelMeasure?: {
    name: string;
    text: string;
    width: number;
    nameWidth: number;
    bubbleHeight: number;
  };
  texture?: CanvasImageSource;
  lookId?: string;
};

/** Three.js presentation consumes the existing gameplay state; it never emits socket payloads. */
export class OfficeRenderer {
  private speechRail = document.createElement("div");
  private renderer: T.WebGLRenderer;
  private environmentTarget: T.WebGLRenderTarget;
  private scene = new T.Scene();
  private sun = new T.DirectionalLight();
  private fill = new T.DirectionalLight();
  private sky = new T.HemisphereLight();
  private seats: Seat[] = [];
  private camera = new T.PerspectiveCamera(38, 1, 0.1, 250);
  private controls: OrbitControls;
  private world = new T.Group();
  private actors = new Map<string, RenderedActor>();
  private ray = new T.Raycaster();
  private ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
  private cursor: T.Mesh;
  private resize: ResizeObserver;
  private frame = 0;
  private statsLabel: HTMLOutputElement | null = null;
  private sampleStart = 0;
  private sampleFrames = 0;
  private slowSamples = 0;
  private priorFrame = 0;
  private sampleIntervals: number[] = [];
  private disposed = false;
  private theme: OfficeTheme = "office";
  private following = true;
  private overviewDimensions: { cols: number; rows: number } | null = null;
  private lastMap = "";
  private mapTimer = 0;
  private bridge: OfficeBridge | null = null;
  private gesture = new PointerGesture();
  private hoveredActorId: string | undefined;
  private selectedActorId: string | undefined;
  private lastActors: ActorSnapshot[] = [];
  private speech = new Map<string, number>();
  private benchmark: {
    capture: FrameBenchmark;
    complete: (report: BenchmarkReport) => void;
  } | null = null;

  constructor(
    private host: HTMLDivElement,
    private labels: HTMLDivElement,
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const room = new RoomEnvironment();
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.28;
    room.dispose();
    pmrem.dispose();
    this.renderer.setClearColor(palettes.office.outside);
    this.renderer.domElement.setAttribute("aria-label", "DeskRPG 3D");
    if (showPerformanceHud(process.env.NODE_ENV, process.env.NEXT_PUBLIC_README_CAPTURE)) {
      this.statsLabel = document.createElement("output");
      this.statsLabel.setAttribute("aria-label", "3D performance");
      this.statsLabel.style.cssText =
        "position:absolute;left:12px;bottom:12px;pointer-events:none;font:11px monospace;color:#344b3c;background:#faf8efde;padding:4px 7px;z-index:5";
      this.statsLabel.textContent = "Measuring 3D frames…";
      this.host.append(this.statsLabel);
    }
    this.host.append(this.renderer.domElement);
    this.speechRail.className = "office-speech-rail";
    this.speechRail.hidden = true;
    this.speechRail.setAttribute("role", "region");
    this.speechRail.setAttribute(
      "aria-label",
      document.documentElement.lang.startsWith("ko") ? "현재 화면의 대화" : "Conversations in view",
    );
    this.speechRail.tabIndex = 0;
    this.labels.append(this.speechRail);
    this.scene.add(this.world, this.sky, this.sun, this.sun.target, this.fill, this.fill.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.018;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 120;
    this.camera.position.set(22, 22, 28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(15, 0, 12);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;
    this.controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
    this.controls.minDistance = 8;
    this.controls.maxDistance = 85;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.15;
    // A short left click walks; dragging pans without issuing a movement command.
    this.controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE };
    this.controls.addEventListener("start", this.stopFollowing);
    this.cursor = new T.Mesh(
      new T.PlaneGeometry(0.96, 0.96),
      new T.MeshBasicMaterial({
        color: "#578467",
        transparent: true,
        opacity: 0.45,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.position.y = 0.025;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    // Finish before OrbitControls releases capture and emits lostpointercapture.
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp, true);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerCancel);
    this.renderer.domElement.addEventListener("lostpointercapture", this.pointerCancel);
    this.renderer.domElement.addEventListener("pointerleave", this.pointerLeave);
    this.renderer.domElement.addEventListener("contextmenu", this.contextMenu);
    this.resize = new ResizeObserver(() => {
      const { width, height } = this.host.getBoundingClientRect();
      if (!width || !height) return;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (this.overviewDimensions)
        this.overview(this.overviewDimensions.cols, this.overviewDimensions.rows);
    });
    this.resize.observe(host);
    document.addEventListener("visibilitychange", this.benchmarkVisibility);
    this.tick(0);
  }
  attach(bridge: OfficeBridge) {
    this.bridge?.setPresentation(false);
    this.bridge = bridge;
    bridge.setPresentation(true);
    this.lastMap = "";
    this.mapTimer = 0;
  }
  /** Diagnostics are public instance APIs, without a global browser hook. */
  readMetrics(): FrameMetrics {
    const statuses = [...this.actors.values()].map(
      (actor) => actor.model.root.userData.assetStatus,
    );
    this.world.traverse((object) => {
      if (object.userData.dynamicAsset) statuses.push(object.userData.assetStatus);
    });
    return {
      pixelRatio: this.renderer.getPixelRatio(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      assetsReady:
        !!this.bridge &&
        this.lastMap === this.bridge.mapKey() &&
        this.actors.size === this.lastActors.length &&
        this.actors.size > 0 &&
        statuses.every((status) => status === "ready" || status === undefined),
      actorCount: this.actors.size,
      viewport: { width: this.host.clientWidth, height: this.host.clientHeight },
      devicePixelRatio: window.devicePixelRatio,
      mapKey: this.lastMap,
    };
  }
  startBenchmark(complete: (report: BenchmarkReport) => void) {
    if (this.benchmark) throw new Error("A benchmark is already running");
    if (document.hidden || !this.readMetrics().assetsReady)
      throw new Error("Keep the ready renderer visible before measuring");
    this.benchmark = { capture: new FrameBenchmark(() => performance.now()), complete };
  }
  cancelBenchmark(reason = "Benchmark cancelled") {
    const active = this.benchmark;
    if (!active) return;
    this.benchmark = null;
    active.complete(active.capture.invalidate(reason));
  }
  private benchmarkVisibility = () => {
    if (document.hidden) this.cancelBenchmark("Document became hidden");
  };
  showRoom(x: number, z: number, distance = 15) {
    this.following = false;
    this.overviewDimensions = null;
    this.controls.target.set(x, 0, z);
    this.camera.position
      .copy(this.controls.target)
      .add(new T.Vector3(0.45, 0.9, 1).normalize().multiplyScalar(distance));
    this.controls.update();
  }
  setTheme(theme: OfficeTheme) {
    this.theme = theme;
    this.lastMap = "";
    this.mapTimer = 0;
  }
  focus() {
    this.following = true;
    this.overviewDimensions = null;
  }
  overview(cols: number, rows: number) {
    this.following = false;
    this.controls.target.set(cols / 2, 0, rows / 2);
    this.overviewDimensions = { cols, rows };
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const distance = overviewDistance(cols, rows, aspect);
    this.controls.maxDistance = Math.max(85, distance * 2);
    this.camera.far = Math.max(250, distance * 4);
    this.camera.updateProjectionMatrix();
    this.camera.position
      .copy(this.controls.target)
      .add(new T.Vector3(0.45, 0.9, 1).normalize().multiplyScalar(distance));
  }
  showOverview() {
    if (this.bridge) {
      const map = this.bridge.map();
      this.overview(map.cols, map.rows);
    }
  }
  setCameraAngle(top: boolean) {
    this.stopFollowing();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new T.Spherical().setFromVector3(offset);
    spherical.phi = top ? 0.15 : Math.PI / 3.5;
    this.camera.position
      .copy(this.controls.target)
      .add(new T.Vector3().setFromSpherical(spherical));
    this.controls.update();
  }
  rotateCamera(direction: number) {
    this.stopFollowing();
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new T.Vector3(0, 1, 0), (direction * Math.PI) / 4);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  zoom(factor: number) {
    this.stopFollowing();
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(factor)
      .clampLength(8, this.controls.maxDistance)
      .add(this.controls.target);
  }
  talk(id: string) {
    this.speech.set(speechActorId(this.lastActors, id), performance.now() + 4000);
  }
  private stopFollowing = () => {
    this.following = false;
    this.overviewDimensions = null;
  };
  private contextMenu = (event: Event) => event.preventDefault();
  private pointerDown = (e: PointerEvent) => {
    this.gesture.start(e);
    if (e.isPrimary && (e.button === 0 || e.button === 2))
      this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.gesture.finish(e)) this.point(e, "down");
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
  };
  private pointerCancel = () => this.gesture.cancel();
  private pointerLeave = () => {
    this.hoveredActorId = undefined;
    this.cursor.visible = false;
    this.renderer.domElement.style.cursor = "default";
  };
  private pointerMove = (e: PointerEvent) => {
    this.gesture.move(e);
    this.point(e, "move");
  };
  private point(e: PointerEvent, kind: "move" | "down") {
    if (!this.bridge) return;
    const rect = this.host.getBoundingClientRect();
    this.ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hit = this.ray.intersectObjects(
      [...this.actors.values()].map((a) => a.model.root),
      true,
    )[0];
    let actorId: string | undefined;
    let target = this.ray.ray.intersectPlane(this.ground, new T.Vector3());
    if (hit && !this.bridge.editor().placement) {
      let root: T.Object3D | null = hit.object;
      while (root && !root.userData.actorId) root = root.parent;
      const actor = this.lastActors.find((a) => a.id === root?.userData.actorId);
      if (actor && actor.kind !== "player") {
        actorId = actor.id;
        if (kind === "down") {
          const p = pixelToWorld(actor.x, actor.y);
          target = new T.Vector3(p.x, 0, p.z);
        }
      }
    }
    if (!actorId && kind === "down" && e.button === 0) {
      const picked = pickFurnitureSeat(this.ray, this.world.children);
      const furnitureHit = picked?.hit;
      const furniture = picked?.owner;
      if (furniture?.userData.seat || furniture?.userData.seats) {
        const candidates: Seat[] = furniture.userData.seats ?? [furniture.userData.seat];
        const free = candidates.filter(
          (seat) =>
            this.bridge!.walkable(
              Math.floor(seat.anchorX ?? seat.x),
              Math.floor(seat.anchorZ ?? seat.z),
            ) &&
            !this.lastActors.some(
              (actor) =>
                actor.kind !== "player" &&
                Math.hypot(
                  actor.x / 32 - (seat.anchorX ?? seat.x),
                  actor.y / 32 - (seat.anchorZ ?? seat.z),
                ) < 0.45,
            ),
        );
        const point = furnitureHit!.point;
        const seat = free.sort(
          (a, b) =>
            Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z),
        )[0];
        if (!seat) return;
        target = new T.Vector3(seat.anchorX ?? seat.x, 0, seat.anchorZ ?? seat.z);
        actorId = "seat-target"; // Avoid legacy nearby-NPC selection when clicking an adjacent cushion.
      }
    }
    this.hoveredActorId = actorId;
    if (kind === "down") this.selectedActorId = actorId;
    this.renderer.domElement.style.cursor = actorId ? "pointer" : "default";
    if (!target) return;
    const col = Math.floor(target.x),
      row = Math.floor(target.z);
    this.cursor.position.set(col + 0.5, 0.025, row + 0.5);
    const edit = this.bridge.editor();
    this.cursor.visible = edit.placement || edit.spawn || edit.enabled;
    (this.cursor.material as T.MeshBasicMaterial).color.set(
      this.bridge.walkable(col, row) ? "#578467" : "#bd6756",
    );
    const pixel = worldToPixel(target.x, target.z);
    if (process.env.NODE_ENV === "development" && kind === "down") {
      // Read-only evidence of the actual raycast target for multi-client seat checks.
      this.renderer.domElement.dataset.pointerTarget = JSON.stringify({
        at: Date.now(),
        x: target.x,
        z: target.z,
        actorId: actorId ?? null,
        button: e.button,
        walkable: this.bridge.walkable(col, row),
      });
    }
    this.bridge.pointer(kind, pixel.x, pixel.y, e.button, e.clientX, e.clientY, actorId);
    if (kind === "down" && e.button === 0) this.focus();
  }
  private buildMap(map: MapSnapshot) {
    disposeTree(this.world);
    const p = isOfficeEnvironmentId(map.environment)
      ? environmentPalettes[map.environment]
      : palettes[this.theme];
    const lighting = officeLighting(
      isOfficeEnvironmentId(map.environment) ? map.environment : undefined,
    );
    this.sun.color.set(lighting.sun);
    this.sun.intensity = lighting.sunIntensity;
    this.sky.color.set(lighting.sky);
    this.sky.groundColor.set("#8a8577");
    this.sky.intensity = lighting.hemisphereIntensity;
    this.fill.color.set("#deebff");
    this.fill.intensity = lighting.fillIntensity;
    this.renderer.toneMappingExposure = lighting.exposure;
    const cx = map.cols / 2,
      cz = map.rows / 2;
    // Daylight comes from the glazed rear of the miniature, not its camera side.
    this.sun.position.set(cx - 12, 26, cz - 18);
    this.sun.target.position.set(cx, 0, cz);
    this.fill.position.set(cx + 15, 14, cz + 12);
    this.fill.target.position.set(cx, 0, cz);
    const extent = shadowExtent(map.cols, map.rows);
    Object.assign(this.sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.renderer.setClearColor(p.outside);
    round(
      this.world,
      map.cols + 0.3,
      0.3,
      map.rows + 0.3,
      p.wood,
      map.cols / 2,
      -0.2,
      map.rows / 2,
    );
    const floorGrain = isOfficeEnvironmentId(map.environment) ? surfaceTexture("wood") : null;
    if (floorGrain) floorGrain.repeat.set(map.cols / 3, map.rows / 2);
    const floor = new T.Mesh(
      new T.PlaneGeometry(map.cols, map.rows),
      new T.MeshStandardMaterial({
        color: p.floor,
        roughness: 0.85,
        bumpMap: floorGrain,
        bumpScale: 0.018,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(map.cols / 2, -0.04, map.rows / 2);
    floor.receiveShadow = true;
    this.world.add(floor);
    if (map.artwork && !isOfficeEnvironmentId(map.environment)) {
      const texture = new T.CanvasTexture(map.artwork);
      texture.colorSpace = T.SRGBColorSpace;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.magFilter = T.LinearFilter;
      const art = new T.Mesh(
        new T.PlaneGeometry(map.cols, map.rows),
        new T.MeshStandardMaterial({
          map: texture,
          bumpMap: floorGrain,
          bumpScale: 0.018,
          transparent: true,
          roughness: 1,
          depthWrite: false,
        }),
      );
      art.rotation.x = -Math.PI / 2;
      art.position.set(map.cols / 2, -0.02, map.rows / 2);
      art.receiveShadow = true;
      this.world.add(art);
    } else if (!isOfficeEnvironmentId(map.environment)) {
      const tiles = new T.InstancedMesh(
        new T.BoxGeometry(0.98, 0.015, 0.98),
        new T.MeshStandardMaterial({ roughness: 0.9 }),
        map.cols * map.rows,
      );
      const matrix = new T.Matrix4();
      let i = 0;
      for (let row = 0; row < map.rows; row++)
        for (let col = 0; col < map.cols; col++) {
          matrix.makeTranslation(col + 0.5, -0.01, row + 0.5);
          tiles.setMatrixAt(i, matrix);
          tiles.setColorAt(
            i++,
            new T.Color(
              map.floor[row]?.[col] === 0
                ? "#c0b5a1"
                : map.floor[row]?.[col] === 12
                  ? "#8caa8b"
                  : (row + col) % 2
                    ? p.floor
                    : "#e8d9bb",
            ),
          );
        }
      tiles.receiveShadow = true;
      this.world.add(tiles);
    }
    if (isOfficeEnvironmentId(map.environment) && map.environment !== "executive") {
      const finish = officeFinish(map.environment);
      const floorMap = surfaceTexture(finish.floor, "color");
      const floorBump = surfaceTexture(finish.floor);
      floorMap.repeat.set(1, 1);
      floorBump.repeat.set(1, 1);
      const floorPieces: { x: number; z: number; w: number; d: number; shade: number }[] = [];
      const depth = finish.floor === "fabric" ? 1 : 0.5;
      const length = finish.floor === "fabric" ? 1 : 2.4;
      for (let z = 0; z < map.rows; z += depth) {
        const offset = finish.floor === "fabric" ? 0 : (Math.round(z / depth) % 3) * 0.8;
        for (let x = -offset; x < map.cols; x += length) {
          const start = Math.max(0, x),
            end = Math.min(map.cols, x + length);
          if (end <= start) continue;
          const hash = Math.abs(Math.sin((x + 11) * 127.1 + (z + 7) * 311.7));
          floorPieces.push({
            x: (start + end) / 2,
            z: z + depth / 2,
            w: end - start - 0.008,
            d: depth - 0.008,
            shade: 0.94 + hash * 0.06,
          });
        }
      }
      const flooring = new T.InstancedMesh(
        new T.PlaneGeometry(1, 1),
        new T.MeshStandardMaterial({
          color: p.floor,
          map: floorMap,
          bumpMap: floorBump,
          bumpScale: 0.008,
          roughness: 0.9,
        }),
        floorPieces.length,
      );
      const floorTransform = new T.Object3D();
      floorPieces.forEach((piece, i) => {
        floorTransform.position.set(piece.x, 0.001, piece.z);
        floorTransform.rotation.set(-Math.PI / 2, 0, 0);
        floorTransform.scale.set(piece.w, piece.d, 1);
        floorTransform.updateMatrix();
        flooring.setMatrixAt(i, floorTransform.matrix);
        flooring.setColorAt(i, new T.Color().setScalar(piece.shade));
      });
      flooring.receiveShadow = true;
      this.world.add(flooring);
      // One draw call for staggered plank joints; no additional collision surfaces.
      const joints: number[] = [];
      const line = (x: number, z: number, x2: number, z2: number) =>
        joints.push(x, 0.003, z, x2, 0.003, z2);
      for (let z = 0.5; finish.floor === "wood" && z < map.rows; z += 0.5) {
        line(0, z, map.cols, z);
        for (let x = (Math.round(z * 2) % 3) * 0.8 + 0.4; x < map.cols; x += 2.4)
          line(x, z - 0.5, x, z);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(joints, 3));
      this.world.add(
        new T.LineSegments(
          geometry,
          new T.LineBasicMaterial({
            color: p.wood,
            transparent: true,
            opacity: 0.17,
            depthWrite: false,
          }),
        ),
      );
    }
    // Known legacy walls become cutaway architectural walls. Custom collision stays semantic,
    // never guessed to be a wall: authored artwork remains visible on its exact tile.
    if (!map.tiled) {
      const architecture = map.floor.map((row, y) =>
        row.map((tile, x) =>
          [2, 7].includes(map.walls[y]?.[x])
            ? map.walls[y][x]
            : [2, 7].includes(tile)
              ? tile
              : map.walls[y]?.[x] || 0,
        ),
      );
      const cells = architecture.flatMap((row, y) =>
        row.flatMap((tile, x) => (tile === 2 ? [{ x, y }] : [])),
      );
      const walls = new T.InstancedMesh(
        new T.BoxGeometry(1, 1.5, 1),
        new T.MeshStandardMaterial({ color: p.wall, roughness: 0.9 }),
        cells.length,
      );
      const matrix = new T.Matrix4();
      cells.forEach((c, i) => {
        matrix.makeTranslation(c.x + 0.5, 0.75, c.y + 0.5);
        walls.setMatrixAt(i, matrix);
      });
      walls.castShadow = true;
      walls.receiveShadow = true;
      this.world.add(walls);
      architecture.forEach((row, y) =>
        row.forEach((tile, x) => {
          if (tile === 7) {
            round(this.world, 0.08, 1.45, 0.15, p.wood, x + 0.08, 0.725, y + 0.5);
            round(this.world, 0.08, 1.45, 0.15, p.wood, x + 0.92, 0.725, y + 0.5);
            round(this.world, 0.92, 0.1, 0.15, p.wood, x + 0.5, 1.4, y + 0.5);
          } else if (tile === 12)
            round(this.world, 0.98, 0.015, 0.98, "#8caa8b", x + 0.5, 0.01, y + 0.5);
        }),
      );
    }
    const tileObjects: MapObject[] = map.tiled
      ? []
      : [map.floor, map.walls].flatMap((layer, layerIndex) =>
          layer.flatMap((row, y) =>
            row.flatMap((value, x) =>
              TILE_ID_TO_OBJECT[value]
                ? [
                    {
                      id: `tile-${layerIndex}-${x}-${y}`,
                      type: TILE_ID_TO_OBJECT[value],
                      col: x,
                      row: y,
                    },
                  ]
                : [],
            ),
          ),
        );
    const furniture = [...tileObjects, ...map.objects];
    const finishedPerimeter =
      !!map.environment && furniture.some((object) => object.type === "room_wall_h");
    const executive = map.environment === "executive";
    if (executive) addExecutiveArchitecture(this.world, map.cols, map.rows);
    if (finishedPerimeter && !executive)
      addOfficePerimeter(this.world, map.cols, map.rows, p.wall, p.wood);
    if (finishedPerimeter && map.environment && !executive)
      addOfficeRoomSurfaces(this.world, map.environment, {
        environmentVersion: map.environmentVersion,
        hasLegacyPartitions: finishedPerimeter,
      });
    this.seats = furnitureSeats(furniture);
    for (const object of furniture) {
      if (
        (finishedPerimeter || executive) &&
        object.type === "cubicle_wall" &&
        (object.col === 0 ||
          object.col === map.cols - 1 ||
          object.row === 0 ||
          object.row === map.rows - 1)
      )
        continue;
      const group = new T.Group(),
        size = getObjectDimensions(object.type, object.direction);
      const furniturePlacement = furnitureOffset(object);
      group.position.set(
        object.col + size.width / 2 + furniturePlacement.x,
        0,
        object.row + size.height / 2 + furniturePlacement.z,
      );
      group.rotation.y = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[
        object.type === "chair"
          ? resolveSeat(object, furniture).direction
          : object.direction || "down"
      ];
      this.world.add(group);
      const type = object.type;
      if (type === "room_wall_h" || type === "room_wall_v") {
        const junction =
          type === "room_wall_v" &&
          furniture.some(
            (other) =>
              other.type === "room_wall_h" &&
              other.row === object.row &&
              other.col === object.col - 1,
          ) &&
          furniture.some(
            (other) =>
              other.type === "room_wall_h" &&
              other.row === object.row &&
              other.col === object.col + 1,
          );
        if (junction) addRoomTJunction(group);
        else addRoomPartition(group, type === "room_wall_v");
        continue;
      }
      if (type === "chair") {
        const seat = resolveSeat(object, furniture);
        group.userData.seat = seat;
        group.position.set(seat.x, 0, seat.z);
      }
      const roomFurniture = buildRoomFurniture(type, executive);
      if (roomFurniture) {
        const seats = sofaSeats(object);
        if (seats.length) group.userData.seats = seats;
        group.add(roomFurniture);
        if (executive) {
          const managerSeat =
            type === "chair" &&
            furniture.some(
              (desk) =>
                desk.type === "executive_desk" &&
                object.col >= desk.col &&
                object.col < desk.col + 4 &&
                object.row === desk.row - 1,
            );
          const asset =
            type === "executive_desk"
              ? "executive-desk"
              : type === "reception_desk"
                ? "desk"
                : type === "bookshelf"
                  ? "bookcase"
                  : managerSeat
                    ? "chair"
                    : type === "chair"
                      ? "guest-chair"
                      : type === "office_sofa"
                        ? "sofa"
                        : type === "office_armchair"
                          ? "armchair"
                          : type === "conference_table"
                            ? "conference"
                            : type === "meeting_table"
                              ? "coffee"
                              : undefined;
          if (asset) void attachFurnitureAsset(roomFurniture, asset);
        }
        continue;
      }
      if (
        type === "cubicle_wall" &&
        !object.direction &&
        object.row > 0 &&
        object.row < map.rows - 1 &&
        (object.col === 0 || object.col === map.cols - 1)
      )
        group.rotation.y = Math.PI / 2;
      if (type === "computer") {
        const executiveDesk =
          executive &&
          furniture.find(
            (desk) =>
              ["reception_desk", "executive_desk"].includes(desk.type) &&
              desk.col === object.col &&
              desk.row === object.row,
          );
        if (executiveDesk) {
          group.position.x = executiveDesk.col + getObjectDimensions(executiveDesk.type).width / 2;
          group.position.y = 0.06;
          group.rotation.y = Math.PI;
        }
      }
      if (
        addOfficeDetails(
          group,
          type,
          p.wood,
          p.wall,
          object.row === 0,
          isOfficeEnvironmentId(map.environment) ? map.environment : undefined,
        )
      ) {
        if (executive && type === "plant")
          void attachSceneAsset(group, (object.col + object.row) % 2 ? "olive" : "ficus");
        continue;
      }
      if (type.includes("desk") || type === "meeting_table") {
        const wide = type === "meeting_table" || type === "reception_desk" ? 1.8 : 0.9,
          deep = type === "meeting_table" ? 1.8 : 0.8;
        round(group, wide, 0.14, deep, p.wood, 0, 0.76, 0);
        for (const x of [-1, 1])
          for (const z of [-1, 1])
            round(group, 0.09, 0.7, 0.09, "#4e6657", x * wide * 0.38, 0.35, z * deep * 0.36);
      } else if (type === "chair") {
        round(group, 0.65, 0.15, 0.65, "#7c9c80", 0, 0.42, 0);
        round(group, 0.65, 0.65, 0.12, "#7c9c80", 0, 0.7, -0.28);
        cylinder(group, 0.07, 0.1, 0.4, "#4e6657", 0, 0.2, 0);
      } else if (type === "plant") {
        cylinder(group, 0.3, 0.22, 0.45, "#d4ae85", 0, 0.23, 0);
        cylinder(group, 0.035, 0.04, 0.7, p.wood, 0, 0.7, 0);
        for (const x of [-0.18, 0.18]) sphere(group, 0.35, "#668863", x, 1.0 + x, 0, 0.8, 1.2, 0.8);
        if (executive)
          void attachSceneAsset(group, (object.col + object.row) % 2 ? "olive" : "ficus");
      } else if (type === "computer") {
        round(group, 0.68, 0.45, 0.09, "#354e49", 0, 1.08, -0.14);
        round(group, 0.59, 0.34, 0.015, "#b9d8cc", 0, 1.08, -0.085);
        round(group, 0.07, 0.2, 0.07, "#354e49", 0, 0.78, -0.14);
      } else if (type === "whiteboard") {
        round(group, 0.94, 0.85, 0.1, "#fbf8e9", 0, 1, 0);
        round(group, 0.95, 0.07, 0.2, p.wood, 0, 0.55, 0);
      } else if (type === "bookshelf") {
        round(group, 0.9, 1.5, 0.38, p.wood, 0, 0.75, 0);
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 5; col++)
            round(
              group,
              0.1,
              0.3,
              0.2,
              ["#7a937a", "#cfaa7d", "#e5d5b5"][col % 3],
              (col - 2) * 0.15,
              0.28 + row * 0.44,
              0.22,
            );
      } else if (type === "water_cooler") {
        round(group, 0.55, 0.65, 0.55, "#f4f1e7", 0, 0.33, 0);
        cylinder(group, 0.2, 0.2, 0.4, "#a7c9d0", 0, 0.87, 0);
      } else
        round(
          group,
          0.8,
          type === "cubicle_wall" ? 1 : 0.75,
          0.6,
          type === "coffee" ? "#435851" : p.wall,
          0,
          0.4,
          0,
        );
    }
    detailSurfaces(
      this.world,
      [p.wood],
      [
        officeFinish(isOfficeEnvironmentId(map.environment) ? map.environment : undefined)
          .upholstery,
        "#7c9c80",
      ],
      ["#35434b", "#77838a"],
    );
    batchStaticFurniture(this.world, true, { vertexColors: true, batchSeats: true });
    batchCoplanarGlass(this.world);
  }
  private createLabel(actor: ActorSnapshot): RenderedActor {
    const color =
      actor.kind === "player"
        ? "#668d72"
        : ["#b98064", "#7c91ab", "#9b87a2", "#a59963"][
            Array.from(actor.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 4
          ];
    const palette = spritePalette(actor.texture);
    const look = resolveOfficeLook(actor.appearance);
    const model = createActor(
      actor.id,
      actor.texture ? palette.shirt : color,
      this.actors.size % 4,
      palette,
      look,
    );
    const label = document.createElement("button"),
      name = document.createElement("span"),
      bubble = document.createElement("span");
    label.className = "office-actor-label";
    name.className = "office-actor-name";
    bubble.className = "office-actor-bubble";
    label.type = "button";
    label.append(name);
    bubble.tabIndex = 0;
    label.dataset.kind = actor.kind;
    label.addEventListener("click", () => {
      this.selectedActorId = actor.id;
      const a = this.lastActors.find((a) => a.id === actor.id);
      if (a && a.kind !== "player") {
        const r = label.getBoundingClientRect();
        this.bridge?.pointer("down", a.x, a.y, 0, r.x, r.y, actor.id);
      }
    });
    label.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const a = this.lastActors.find((a) => a.id === actor.id);
      if (a) this.bridge?.pointer("down", a.x, a.y, 2, event.clientX, event.clientY, actor.id);
    });
    this.labels.append(label, bubble);
    this.scene.add(model.root);
    return {
      model,
      label,
      name,
      bubble,
      texture: actor.texture,
      lookId: resolveOfficeLook(actor.appearance)?.id,
    };
  }
  private tick = (time: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden) {
      this.priorFrame = 0;
      this.sampleStart = 0;
      this.sampleIntervals = [];
      return;
    }
    if (this.bridge) {
      if (time >= this.mapTimer) {
        const fingerprint = this.bridge.mapKey();
        if (fingerprint !== this.lastMap) {
          this.buildMap(this.bridge.map());
          this.lastMap = fingerprint;
        }
        this.mapTimer = time + 1500;
      }
      this.lastActors = this.bridge.actors();
      const ids = new Set(this.lastActors.map((a) => a.id));
      for (const [id, actor] of this.actors)
        if (!ids.has(id)) {
          this.scene.remove(actor.model.root);
          disposeTree(actor.model.root);
          actor.label.remove();
          actor.bubble.remove();
          this.actors.delete(id);
          this.speech.delete(id);
        }
      const player = this.lastActors.find((a) => a.kind === "player");
      if (this.following && player) {
        const p = pixelToWorld(player.x, player.y),
          target = new T.Vector3(p.x, 0, p.z);
        const offset = target.sub(this.controls.target).multiplyScalar(0.08);
        this.controls.target.add(offset);
        this.camera.position.add(offset);
      }
      this.controls.update();
      const labelAnchors: ActorLabelAnchor[] = [];
      const viewportWidth = this.host.clientWidth;
      const viewportHeight = this.host.clientHeight;
      const speechWidth = bubbleWidthFor(viewportWidth);
      for (const actor of this.lastActors) {
        let rendered = this.actors.get(actor.id);
        if (
          rendered &&
          (rendered.texture !== actor.texture ||
            rendered.lookId !== resolveOfficeLook(actor.appearance)?.id)
        ) {
          this.scene.remove(rendered.model.root);
          disposeTree(rendered.model.root);
          rendered.label.remove();
          rendered.bubble.remove();
          this.actors.delete(actor.id);
          rendered = undefined;
        }
        if (!rendered) {
          rendered = this.createLabel(actor);
          this.actors.set(actor.id, rendered);
        }
        const { model, label, name, bubble } = rendered,
          p = pixelToWorld(actor.x, actor.y);
        const seat = seatAt(this.seats, p.x, p.z, actor.walking);
        model.root.position.set(seat?.x ?? p.x, seat?.elevation ?? 0, seat?.z ?? p.z);
        const previous = rendered.previous;
        const fallbackYaw =
          { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[
            seat?.direction ?? actor.direction
          ] ?? 0;
        const dx = p.x - (previous?.x ?? p.x),
          dz = p.z - (previous?.z ?? p.z);
        if (seat || !previous || (!actor.walking && previous.direction !== actor.direction))
          rendered.yaw = fallbackYaw;
        else if (actor.walking && Math.hypot(dx, dz) > 0.0001 && Math.hypot(dx, dz) < 2)
          rendered.yaw = Math.atan2(dx, dz);
        model.rig.rotation.y =
          seat || !previous
            ? fallbackYaw
            : turnToward(
                model.rig.rotation.y,
                rendered.yaw ?? fallbackYaw,
                (time - previous.time) / 1000,
              );
        rendered.previous = { x: p.x, z: p.z, time, direction: actor.direction };
        model.update(time / 1000, actor.walking, actorPresentationPhase(actor), !!seat);
        label.dataset.assetStatus = model.root.userData.assetStatus ?? "procedural";
        label.dataset.modelStyle = model.root.userData.modelStyle ?? "legacy";
        label.dataset.officeLookId = rendered.lookId ?? "";
        label.dataset.seated = String(!!seat);
        if (process.env.NODE_ENV === "development") {
          label.dataset.worldX = p.x.toFixed(3);
          label.dataset.worldZ = p.z.toFixed(3);
          label.dataset.walking = String(actor.walking);
        }
        const phase = actorPresentationPhase(actor);
        label.dataset.phase = phase;
        label.dataset.hovered = String(actor.id === this.hoveredActorId);
        if (actor.id === this.hoveredActorId || phase === "attention")
          model.ring.material.opacity = 0.65;
        name.textContent = actor.name;
        label.setAttribute("aria-label", actor.name);
        const message = actor.bubble || ((this.speech.get(actor.id) || 0) > time ? "···" : "");
        const indicator = INDICATOR_GLYPH[actorIndicator(actor) ?? "none"];
        const text = [indicator, message].filter(Boolean).join(" ");
        const screen = new T.Vector3(seat?.x ?? p.x, 0, seat?.z ?? p.z).project(this.camera);
        const visible =
          screen.z >= -1 && screen.z <= 1 && Math.abs(screen.x) <= 1 && Math.abs(screen.y) <= 1;
        label.hidden = !visible;
        bubble.hidden = !visible || !text;
        bubble.dataset.active = String(!!actor.active);
        if (!visible) continue;
        // Measure only when content/viewport changes; layout itself is pure screen-space arithmetic.
        const measure = rendered.labelMeasure;
        if (
          !measure ||
          measure.name !== actor.name ||
          measure.text !== text ||
          measure.width !== speechWidth
        ) {
          // A previously docked/offscreen bubble may have a hidden parent while remeasuring.
          if (bubble.parentElement !== this.labels) this.labels.append(bubble);
          bubble.textContent = text ? `${actor.name} · ${text}` : "";
          bubble.style.width = `${speechWidth}px`;
          rendered.labelMeasure = {
            name: actor.name,
            text,
            width: speechWidth,
            nameWidth: name.offsetWidth || 90,
            bubbleHeight: text ? bubble.getBoundingClientRect().height : 0,
          };
        }
        const head = new T.Vector3(seat?.x ?? p.x, seat ? 2.0 : 2.7, seat?.z ?? p.z).project(
          this.camera,
        );
        labelAnchors.push({
          id: actor.id,
          x: ((screen.x + 1) * viewportWidth) / 2,
          feetY: ((1 - screen.y) * viewportHeight) / 2,
          headY: ((1 - head.y) * viewportHeight) / 2,
          nameWidth: rendered.labelMeasure!.nameWidth,
          nameHeight: 26,
          bubbleHeight: text ? rendered.labelMeasure!.bubbleHeight : undefined,
          priority:
            actor.id === this.hoveredActorId || actor.id === this.selectedActorId
              ? 110
              : actor.kind === "player"
                ? 100
                : phase === "streaming" || !!message
                  ? 80
                  : actor.active
                    ? 50
                    : 0,
        });
      }
      const layout = layoutActorLabels(labelAnchors, viewportWidth, viewportHeight);
      this.speechRail.hidden = !layout.rail;
      if (layout.rail) {
        const rect = layout.rail;
        this.speechRail.style.left = `${rect.x}px`;
        this.speechRail.style.top = `${rect.y}px`;
        this.speechRail.style.width = `${rect.width}px`;
        this.speechRail.style.maxHeight = `${rect.height}px`;
      }
      for (const anchor of labelAnchors) {
        const actor = this.actors.get(anchor.id)!;
        const placement = layout.placements.get(anchor.id)!;
        actor.label.hidden = !placement.name;
        if (placement.name) {
          actor.label.style.transform = `translate(${placement.name.x}px,${placement.name.y}px)`;
          actor.label.style.zIndex = String(anchor.priority + 1);
        }
        actor.bubble.hidden = !placement.bubble && !placement.docked;
        if (placement.bubble) {
          if (actor.bubble.parentElement !== this.labels) this.labels.append(actor.bubble);
          actor.bubble.style.transform = `translate(${placement.bubble.x}px,${placement.bubble.y}px)`;
          actor.bubble.style.zIndex = String(anchor.priority + 1);
        }
      }
      // Stable priority order and speaker prefix retain readable text for every visible overflow speaker.
      for (const [index, id] of layout.overflow.entries()) {
        const bubble = this.actors.get(id)!.bubble;
        const current = this.speechRail.children[index];
        if (current !== bubble) this.speechRail.insertBefore(bubble, current ?? null);
        bubble.style.transform = "none";
      }
    }
    if (!document.hidden) {
      if (!this.sampleStart) this.sampleStart = time;
      if (this.priorFrame && time - this.priorFrame < 250)
        this.sampleIntervals.push(time - this.priorFrame);
      this.sampleFrames++;
      if (time - this.sampleStart >= 3000 && this.sampleIntervals.length > 30) {
        const sorted = this.sampleIntervals.sort((a, b) => a - b);
        const fps = Math.round((1000 * sorted.length) / sorted.reduce((a, b) => a + b, 0));
        const adaptation = adaptRenderScale(
          this.renderer.getPixelRatio(),
          this.slowSamples,
          fps,
          sorted[Math.floor(sorted.length * 0.95)],
        );
        this.slowSamples = adaptation.slowSamples;
        if (adaptation.scale !== this.renderer.getPixelRatio())
          this.renderer.setPixelRatio(adaptation.scale);
        if (this.statsLabel)
          this.statsLabel.textContent = `${fps} fps · ${this.renderer.getPixelRatio().toFixed(2)}× · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms · ${this.renderer.info.render.calls} draws · ${Math.round(this.renderer.info.render.triangles / 1000)}k triangles`;
        this.sampleStart = time;
        this.sampleFrames = 0;
        this.sampleIntervals = [];
      }
      this.priorFrame = time;
    } else {
      this.slowSamples = 0;
      this.priorFrame = 0;
      this.sampleStart = 0;
      this.sampleIntervals = [];
    }
    this.renderer.render(this.scene, this.camera);
    if (this.benchmark) {
      const active = this.benchmark;
      const report = active.capture.frame(this.readMetrics(), !document.hidden);
      if (report) {
        this.benchmark = null;
        active.complete(report);
      }
    }
  };
  dispose() {
    this.cancelBenchmark("Renderer disposed");
    document.removeEventListener("visibilitychange", this.benchmarkVisibility);
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.bridge?.setPresentation(false);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp, true);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerCancel);
    this.renderer.domElement.removeEventListener("lostpointercapture", this.pointerCancel);
    this.renderer.domElement.removeEventListener("pointerleave", this.pointerLeave);
    this.renderer.domElement.removeEventListener("contextmenu", this.contextMenu);
    disposeTree(this.scene);
    this.environmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.statsLabel?.remove();
    this.labels.replaceChildren();
    this.actors.clear();
  }
}
