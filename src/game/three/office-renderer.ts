import * as T from "three";
import { spritePalette } from "./appearance";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createActor, round, sphere, cylinder } from "./characters";
import {
  pixelToWorld,
  overviewDistance,
  worldToPixel,
  type ActorSnapshot,
  type OfficeBridge,
  type MapSnapshot,
} from "./bridge";
import { getObjectDimensions, TILE_ID_TO_OBJECT, type MapObject } from "../../lib/object-types";

export function disposeTree(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (object instanceof T.DirectionalLight || object instanceof T.SpotLight)
      object.shadow.dispose();
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      const map = (material as T.MeshStandardMaterial).map;
      if (map) textures.add(map);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  root.clear();
}

const palettes = {
  office: { floor: "#e3d0aa", wall: "#dae2d2", wood: "#b48a60", outside: "#e9eee2" },
  hanok: { floor: "#ddc6a2", wall: "#eee5cc", wood: "#765644", outside: "#e2e9da" },
  cafe: { floor: "#cbb49b", wall: "#dcc4ae", wood: "#895c43", outside: "#f1e5d8" },
};
export type OfficeTheme = keyof typeof palettes;

type RenderedActor = {
  model: ReturnType<typeof createActor>;
  label: HTMLButtonElement;
  name: HTMLSpanElement;
  bubble: HTMLSpanElement;
  texture?: CanvasImageSource;
};

/** Three.js presentation consumes the existing gameplay state; it never emits socket payloads. */
export class OfficeRenderer {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(38, 1, 0.1, 250);
  private controls: OrbitControls;
  private world = new T.Group();
  private actors = new Map<string, RenderedActor>();
  private ray = new T.Raycaster();
  private ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
  private cursor: T.Mesh;
  private resize: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private theme: OfficeTheme = "office";
  private following = true;
  private overviewDimensions: { cols: number; rows: number } | null = null;
  private lastMap = "";
  private mapTimer = 0;
  private bridge: OfficeBridge | null = null;
  private down: { x: number; y: number } | null = null;
  private lastActors: ActorSnapshot[] = [];
  private speech = new Map<string, number>();

  constructor(
    private host: HTMLDivElement,
    private labels: HTMLDivElement,
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor(palettes.office.outside);
    this.renderer.domElement.setAttribute("aria-label", "DeskRPG 3D");
    this.host.append(this.renderer.domElement);
    this.scene.add(this.world, new T.HemisphereLight("#fff7e4", "#a0b096", 2.4));
    const sun = new T.DirectionalLight("#fff5dc", 3.2);
    sun.position.set(15, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 100 });
    sun.shadow.normalBias = 0.045;
    this.scene.add(sun);
    this.camera.position.set(22, 22, 28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(15, 0, 12);
    this.controls.enableDamping = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 85;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.15;
    // Left click walks. Drag right button rotates; middle drag pans, wheel zooms.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE };
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
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
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
    this.tick(0);
  }
  attach(bridge: OfficeBridge) {
    this.bridge?.setPresentation(false);
    this.bridge = bridge;
    bridge.setPresentation(true);
    this.lastMap = "";
    this.mapTimer = 0;
  }
  setTheme(theme: OfficeTheme) {
    this.theme = theme;
    this.lastMap = "";
    this.mapTimer = 0;
  }
  focus() {
    this.following = true;
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
  zoom(factor: number) {
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(factor)
      .clampLength(8, this.controls.maxDistance)
      .add(this.controls.target);
  }
  talk(id: string) {
    this.speech.set(id, performance.now() + 4000);
  }
  private stopFollowing = () => {
    this.following = false;
    this.overviewDimensions = null;
  };
  private contextMenu = (event: Event) => event.preventDefault();
  private pointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5)
      this.point(e, "down");
    this.down = null;
  };
  private pointerMove = (e: PointerEvent) => this.point(e, "move");
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
    if (kind === "down" && hit) {
      let root: T.Object3D | null = hit.object;
      while (root && !root.userData.actorId) root = root.parent;
      const actor = this.lastActors.find((a) => a.id === root?.userData.actorId);
      if (actor && actor.kind !== "player") {
        actorId = actor.id;
        const p = pixelToWorld(actor.x, actor.y);
        target = new T.Vector3(p.x, 0, p.z);
      }
    }
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
    this.bridge.pointer(kind, pixel.x, pixel.y, e.button, e.clientX, e.clientY, actorId);
    if (kind === "down" && e.button === 0) this.following = true;
  }
  private buildMap(map: MapSnapshot) {
    disposeTree(this.world);
    const p = palettes[this.theme];
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
    const floor = new T.Mesh(
      new T.PlaneGeometry(map.cols, map.rows),
      new T.MeshStandardMaterial({ color: p.floor, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(map.cols / 2, -0.04, map.rows / 2);
    floor.receiveShadow = true;
    this.world.add(floor);
    if (map.artwork) {
      const texture = new T.CanvasTexture(map.artwork);
      texture.colorSpace = T.SRGBColorSpace;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.magFilter = T.LinearFilter;
      const art = new T.Mesh(
        new T.PlaneGeometry(map.cols, map.rows),
        new T.MeshStandardMaterial({
          map: texture,
          transparent: true,
          roughness: 1,
          depthWrite: false,
        }),
      );
      art.rotation.x = -Math.PI / 2;
      art.position.set(map.cols / 2, -0.02, map.rows / 2);
      art.receiveShadow = true;
      this.world.add(art);
    } else {
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
    for (const object of [...tileObjects, ...map.objects]) {
      const group = new T.Group(),
        size = getObjectDimensions(object.type, object.direction);
      group.position.set(object.col + size.width / 2, 0, object.row + size.height / 2);
      group.rotation.y = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[
        object.direction || "down"
      ];
      this.world.add(group);
      const type = object.type;
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
  }
  private createLabel(actor: ActorSnapshot): RenderedActor {
    const color =
      actor.kind === "player"
        ? "#668d72"
        : ["#b98064", "#7c91ab", "#9b87a2", "#a59963"][
            Array.from(actor.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 4
          ];
    const palette = spritePalette(actor.texture);
    const model = createActor(
      actor.id,
      actor.texture ? palette.shirt : color,
      this.actors.size % 4,
      palette,
    );
    const label = document.createElement("button"),
      name = document.createElement("span"),
      bubble = document.createElement("span");
    label.className = "office-actor-label";
    name.className = "office-actor-name";
    bubble.className = "office-actor-bubble";
    label.type = "button";
    label.append(bubble, name);
    label.dataset.kind = actor.kind;
    label.addEventListener("click", () => {
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
    this.labels.append(label);
    this.scene.add(model.root);
    return { model, label, name, bubble, texture: actor.texture };
  }
  private tick = (time: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
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
          this.actors.delete(id);
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
      for (const actor of this.lastActors) {
        let rendered = this.actors.get(actor.id);
        if (rendered && rendered.texture !== actor.texture) {
          this.scene.remove(rendered.model.root);
          disposeTree(rendered.model.root);
          rendered.label.remove();
          this.actors.delete(actor.id);
          rendered = undefined;
        }
        if (!rendered) {
          rendered = this.createLabel(actor);
          this.actors.set(actor.id, rendered);
        }
        const { model, label, name, bubble } = rendered,
          p = pixelToWorld(actor.x, actor.y);
        model.root.position.set(p.x, 0, p.z);
        model.rig.rotation.y =
          { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[actor.direction] ?? 0;
        model.update(
          time / 1000,
          actor.walking,
          actor.active ? "thinking" : actor.bubble ? "streaming" : "idle",
          false,
        );
        name.textContent = actor.name;
        label.setAttribute("aria-label", actor.name);
        const message = actor.bubble || ((this.speech.get(actor.id) || 0) > time ? "···" : "");
        bubble.textContent = message;
        bubble.hidden = !message;
        bubble.dataset.active = String(!!actor.active);
        const screen = new T.Vector3(p.x, 1.7, p.z).project(this.camera);
        label.hidden =
          screen.z < -1 || screen.z > 1 || Math.abs(screen.x) > 1.1 || Math.abs(screen.y) > 1.1;
        label.style.transform = `translate(${((screen.x + 1) * this.host.clientWidth) / 2}px,${((1 - screen.y) * this.host.clientHeight) / 2}px) translate(-50%,-100%)`;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.bridge?.setPresentation(false);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("contextmenu", this.contextMenu);
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.replaceChildren();
    this.actors.clear();
  }
}
