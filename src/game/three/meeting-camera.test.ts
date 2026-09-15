import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { MeetingCamera } from "./meeting-camera";
import { OfficeRenderer } from "./office-renderer";
import { MeetingWallOcclusion } from "./meeting-wall-occlusion";
import { FurnitureHighlight } from "./furniture-highlight";
import { BoardArrival } from "./office-kanban";
import type { MeetingSpace } from "../meeting-space";
import type { ActorSnapshot, MapSnapshot } from "./bridge";

const space: MeetingSpace = {
  id: "room",
  version: 1,
  bounds: { x: 10, y: 5, width: 8, height: 6 },
  entry: { x: 10, y: 7 },
  seatIds: [],
  standingPositions: [],
  wallObjectIds: [],
  wallTileKeys: [],
};
const actors: ActorSnapshot[] = [
  {
    id: "socket",
    userId: "user",
    kind: "player",
    name: "Same",
    x: 12 * 32,
    y: 7 * 32,
    direction: "down",
    walking: false,
  },
  {
    id: "npc",
    kind: "npc",
    name: "Same",
    x: 16 * 32,
    y: 9 * 32,
    direction: "down",
    walking: false,
    phase: "streaming",
  },
];
function setup(reducedMotion = true) {
  const camera = new T.PerspectiveCamera(38, 2, 0.1, 250);
  camera.position.set(20, 20, 30);
  const controls = {
    target: new T.Vector3(),
    enablePan: true,
    enableZoom: true,
    enableDamping: true,
    minDistance: 8,
    maxDistance: 85,
    mouseButtons: { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE },
    touches: { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE },
  };
  const meeting = new MeetingCamera(camera, controls, { reducedMotion });
  meeting.setViewport(1200, 600, 350);
  return { camera, controls, meeting };
}
test("meeting locks navigation, restores camera and controls, and can reenter", () => {
  const { camera, controls, meeting } = setup();
  const original = camera.position.clone();
  meeting.enter(space);
  meeting.update(1, actors);
  assert.equal(controls.enablePan, false);
  assert.equal(controls.enableZoom, false);
  assert.equal(controls.touches.ONE, T.TOUCH.ROTATE);
  assert.equal(controls.mouseButtons.LEFT, T.MOUSE.ROTATE);
  assert.equal(controls.target.x, 14);
  meeting.exit();
  assert.equal(controls.enablePan, true);
  assert.equal(controls.enableZoom, true);
  assert.ok(camera.position.equals(original));
  assert.equal(camera.view?.enabled ?? false, false);
  meeting.enter(space);
  meeting.dispose();
  assert.equal(controls.enablePan, true);
});

function rebuildingRenderer() {
  const { camera, controls, meeting } = setup();
  const renderer = Object.create(OfficeRenderer.prototype) as OfficeRenderer;
  let assetVersion = 1;
  let map: MapSnapshot = {
    cols: 20,
    rows: 12,
    floor: [],
    walls: [],
    blocked: [],
    tiled: false,
    objects: [{ id: "meeting-wall", type: "room_wall_h", col: 11, row: 8 }],
    meetingSpace: { ...space, wallObjectIds: ["meeting-wall"] },
  };
  const world = new T.Group();
  const scene = new T.Scene();
  scene.add(world);
  const meetingWalls = new MeetingWallOcclusion();
  Object.assign(renderer, {
    camera,
    controls: { ...controls, update() {} },
    meetingCamera: meeting,
    meetingWalls,
    furnitureHighlight: new FurnitureHighlight(),
    boardArrival: new BoardArrival(),
    meetingWallObjects: [],
    world,
    scene,
    theme: "office",
    sun: new T.DirectionalLight(),
    fill: new T.DirectionalLight(),
    sky: new T.HemisphereLight(),
    renderer: { setClearColor() {}, shadowMap: { type: T.PCFShadowMap } },
    following: true,
    overviewDimensions: { cols: 20, rows: 12 },
    host: { clientWidth: 1200, clientHeight: 600, dataset: {} },
    cursor: { visible: true },
    meetingRightInset: 0,
    bridge: { map: () => map, mapKey: () => `asset-${assetVersion}` },
    setHoveredSeat() {},
    setSelectedSeat() {},
    stopFollowing() {},
  });
  return {
    renderer,
    camera,
    controls,
    meeting,
    meetingWalls,
    world,
    refresh(next = map) {
      map = next;
      assetVersion++;
      // 실제 tick도 같은 buildMap 경로를 사용한다. 진입 메서드로 WebGL 없이 그 경로를 실행한다.
      renderer.enterMeeting();
    },
    map: () => map,
    rebuild(next: MapSnapshot) {
      (renderer as unknown as { buildMap(map: MapSnapshot): void }).buildMap(next);
    },
  };
}

test("증축 표식의 ID·좌표·타입이 맞는 벽만 생략하거나 세로 경계로 그린다", () => {
  const fixture = rebuildingRenderer();
  const objects = [
    { id: "hidden", type: "room_wall_h", col: 2, row: 2 },
    { id: "vertical", type: "room_wall_h", col: 4, row: 2 },
    { id: "moved", type: "room_wall_h", col: 6, row: 2 },
    { id: "user", type: "room_wall_h", col: 8, row: 2 },
    { id: "corner", type: "room_wall_h", col: 10, row: 2 },
  ];
  const markers: NonNullable<MeetingSpace["generatedAnnexWalls"]> = [
    { id: "hidden", type: "room_wall_h", col: 2, row: 2, display: "hidden" },
    { id: "vertical", type: "room_wall_h", col: 4, row: 2, display: "vertical" },
    { id: "moved", type: "room_wall_h", col: 5, row: 2, display: "hidden" },
    { id: "user", type: "room_wall_v" as "room_wall_h", col: 8, row: 2, display: "hidden" },
    { id: "corner", type: "room_wall_h", col: 10, row: 2, display: "corner" },
  ];
  const map = {
    ...fixture.map(),
    objects,
    meetingSpace: { ...space, generatedAnnexWalls: markers },
  };
  const before = structuredClone(map);
  fixture.rebuild(map);
  const candidates = (fixture.renderer as unknown as { meetingWallObjects: T.Object3D[] })
    .meetingWallObjects;
  assert.equal(candidates.length, 4);
  const sizes = candidates.map((candidate) =>
    new T.Box3().setFromObject(candidate).getSize(new T.Vector3()),
  );
  assert.ok(sizes[0].z > sizes[0].x);
  assert.ok(sizes[1].x > sizes[1].z);
  assert.ok(sizes[2].x > sizes[2].z);
  assert.ok(sizes[3].x >= 1 && sizes[3].z >= 1);
  assert.deepEqual(map, before);
  fixture.rebuild({ ...map, meetingSpace: space });
  assert.equal(
    (fixture.renderer as unknown as { meetingWallObjects: T.Object3D[] }).meetingWallObjects.length,
    5,
  );
});

for (const environment of ["executive", "tech", undefined]) {
  test(`renderer registers all indoor walls, including ${environment ?? "legacy"} shell occluders`, () => {
    const fixture = rebuildingRenderer();
    const map: MapSnapshot = {
      ...fixture.map(),
      environment,
      floor: [[0, 0, 0, 0, 0, 2, 7]],
      walls: [],
      objects: [
        { id: "distant-wall", type: "room_wall_h", col: 3, row: 3 },
        { id: "distant-cubicle", type: "cubicle_wall", col: 8, row: 3 },
        { id: "floor-rug", type: "rug", col: 5, row: 5 },
      ],
      meetingSpace: { ...space, wallObjectIds: [], wallTileKeys: [] },
    };
    fixture.rebuild(map);
    const candidates = (fixture.renderer as unknown as { meetingWallObjects: T.Object3D[] })
      .meetingWallObjects;
    const meshes = new Set<T.Mesh>();
    for (const candidate of candidates)
      candidate.traverse((child) => {
        if (child instanceof T.Mesh) meshes.add(child);
      });
    const points = [
      [new T.Vector3(5.5, 0.75, -2), new T.Vector3(5.5, 0.75, 2)],
      [new T.Vector3(3.5, 1, 2), new T.Vector3(3.5, 1, 5)],
    ];
    if (environment) points.push([new T.Vector3(-2, 0.6, 6), new T.Vector3(4, 0.6, 6)]);
    fixture.world.updateMatrixWorld(true);
    const originals = new Map([...meshes].map((mesh) => [mesh, mesh.material]));
    for (const [camera, target] of points) {
      const ray = new T.Raycaster(
        camera,
        target.clone().sub(camera).normalize(),
        0,
        camera.distanceTo(target),
      );
      const hits = ray
        .intersectObject(fixture.world, true)
        .filter((hit) => hit.object instanceof T.Mesh);
      assert.ok(hits.length > 0);
      for (const hit of hits)
        assert.ok(meshes.has(hit.object as T.Mesh), `unregistered wall at ${hit.point.toArray()}`);
      fixture.meetingWalls.enter(candidates);
      fixture.meetingWalls.update(camera, [target]);
      const blocking = new Set(hits.map((hit) => hit.object));
      let disposed = 0;
      let clones = 0;
      for (const mesh of meshes) {
        if (!blocking.has(mesh)) {
          assert.equal(mesh.material, originals.get(mesh));
          continue;
        }
        assert.notEqual(mesh.material, originals.get(mesh));
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          assert.ok(material.opacity <= 0.12);
          clones++;
          material.addEventListener("dispose", () => disposed++);
        }
      }
      fixture.meetingWalls.dispose();
      assert.equal(disposed, clones);
      for (const mesh of meshes) assert.equal(mesh.material, originals.get(mesh));
    }
    assert.ok(
      [...meshes].every((mesh) => !(mesh instanceof T.InstancedMesh)),
      "candidate geometry survives batching",
    );
    const floorRay = new T.Raycaster(new T.Vector3(5.5, 2, 5.5), new T.Vector3(0, -1, 0));
    const floorHits = floorRay.intersectObject(fixture.world, true);
    assert.ok(floorHits.length > 0);
    assert.ok(
      floorHits.every((hit) => !meshes.has(hit.object as T.Mesh)),
      "floor and rugs are not wall candidates",
    );
  });
}

test("같은 지도의 늦은 텍스처 갱신은 회의·수동 방향·발언·복원값을 유지한다", () => {
  const fixture = rebuildingRenderer();
  const { renderer, camera, controls, meeting } = fixture;
  const original = camera.position.clone();
  renderer.enterMeeting();
  renderer.setMeetingSpeaker({ kind: "npc", id: "npc", utteranceId: "turn-1" });
  meeting.update(1, actors);
  const speakerTarget = controls.target.clone();
  renderer.rotateCamera(1);
  const manualPosition = camera.position.clone();
  const states: boolean[] = [];
  renderer.onMeetingCameraChange = (state) => states.push(state.active);
  fixture.refresh();
  assert.equal(renderer.meetingCameraState().active, true);
  assert.equal(renderer.meetingCameraState().automatic, false);
  assert.ok(camera.position.equals(manualPosition), "수동 방향이 재진입으로 초기화되면 안 된다");
  assert.deepEqual(states, [], "자산 재생성이 회의 종료 사건을 내보내면 안 된다");
  renderer.resumeMeetingAuto();
  meeting.update(1, actors);
  assert.ok(controls.target.equals(speakerTarget), "현재 발언을 유지해야 한다");
  renderer.exitMeeting();
  assert.ok(camera.position.equals(original));
  assert.equal((renderer as unknown as { following: boolean }).following, true);
  assert.deepEqual((renderer as unknown as { overviewDimensions: unknown }).overviewDimensions, {
    cols: 20,
    rows: 12,
  });
});

test("자산 갱신은 이전 벽 재질을 복원·해제한 뒤 새 회의 벽에만 가림 처리를 연결한다", () => {
  const fixture = rebuildingRenderer();
  fixture.renderer.enterMeeting();
  const firstWall = () => {
    let mesh: T.Mesh | undefined;
    (
      fixture.renderer as unknown as { meetingWallObjects: T.Object3D[] }
    ).meetingWallObjects[0].traverse((object) => {
      if (!mesh && object instanceof T.Mesh) mesh = object;
    });
    assert.ok(mesh);
    return mesh;
  };
  const obscure = (mesh: T.Mesh) => {
    const center = mesh.getWorldPosition(new T.Vector3());
    fixture.meetingWalls.update(center.clone().add(new T.Vector3(0, 0, 5)), [
      center.clone().add(new T.Vector3(0, 0, -5)),
    ]);
  };
  const oldWall = firstWall();
  const original = oldWall.material;
  obscure(oldWall);
  assert.notEqual(oldWall.material, original);
  const faded = Array.isArray(oldWall.material) ? oldWall.material : [oldWall.material];
  let disposed = 0;
  faded.forEach((material) => material.addEventListener("dispose", () => disposed++));
  fixture.refresh();
  assert.equal(oldWall.material, original);
  assert.equal(disposed, faded.length);
  const nextWall = firstWall();
  assert.notEqual(nextWall, oldWall);
  const nextOriginal = nextWall.material;
  obscure(nextWall);
  assert.notEqual(nextWall.material, nextOriginal, "새 벽도 가림 대상이어야 한다");
  fixture.renderer.exitMeeting();
  assert.equal(nextWall.material, nextOriginal);
});

for (const environment of ["tech", "trading", "publishing"]) {
  test(`${environment} v3 비동기 마감과 같은 맵 재생성 뒤에도 회의벽 차폐를 유지한다`, async (t) => {
    t.mock.method(
      T.TextureLoader.prototype,
      "load",
      (_url: string, onLoad?: (texture: T.Texture) => void) => {
        const texture = new T.Texture();
        onLoad?.(texture);
        return texture;
      },
    );
    const fixture = rebuildingRenderer();
    fixture.refresh({ ...fixture.map(), environment, environmentVersion: 3 });
    const finish = async () => {
      const marker = fixture.world.getObjectByName(`${environment}-scene-ready`)!;
      assert.ok(marker);
      await marker.userData.assetReady;
      assert.equal(fixture.meeting.active, true);
      const wall = fixture.world.getObjectByName("generic-object:meeting-wall")!;
      const meshes: T.Mesh[] = [];
      wall.traverse((object) => {
        if (object instanceof T.Mesh) meshes.push(object);
      });
      const originals = meshes.map((mesh) => mesh.material);
      fixture.meetingWalls.update(new T.Vector3(11.5, 1, 6), [new T.Vector3(11.5, 1, 10)]);
      assert.ok(meshes.some((mesh, index) => mesh.material !== originals[index]));
    };
    await finish();
    fixture.refresh();
    await finish();
    fixture.renderer.exitMeeting();
  });
}

test("같은 경계라도 실제 가구·좌석·지도·회의 공간 변경은 회의 모드를 종료한다", () => {
  const fixture = rebuildingRenderer();
  for (const change of [
    (map: MapSnapshot) => ({
      ...map,
      objects: [...map.objects, { id: "chair", type: "chair", col: 12, row: 9 }],
    }),
    (map: MapSnapshot) => ({ ...map, floor: [[1]] }),
    (map: MapSnapshot) => ({ ...map, blocked: ["12,9"] }),
    (map: MapSnapshot) => ({
      ...map,
      meetingSpace: { ...map.meetingSpace!, bounds: { ...space.bounds, x: 11 } },
    }),
    (map: MapSnapshot) => ({ ...map, meetingSpace: undefined }),
  ]) {
    fixture.renderer.enterMeeting();
    fixture.rebuild(change(fixture.map()));
    assert.equal(fixture.renderer.meetingCameraState().active, false);
  }
  fixture.renderer.enterMeeting();
  fixture.map().objects[0].col += 1;
  fixture.rebuild(fixture.map());
  assert.equal(
    fixture.renderer.meetingCameraState().active,
    false,
    "같은 객체를 제자리 수정해도 변경으로 판정한다",
  );
});
test("speaker identity uses typed IDs, never names; missing/thinking speakers show room", () => {
  const { controls, meeting } = setup();
  meeting.enter(space);
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(1, actors);
  assert.ok(controls.target.x < 14);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "two" });
  meeting.update(1, actors);
  assert.ok(controls.target.x > 14);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "thought", phase: "thinking" });
  meeting.update(1, actors);
  assert.equal(controls.target.x, 14);
  meeting.setSpeaker({ kind: "user", id: "Same", utteranceId: "three" });
  meeting.update(1, actors);
  assert.equal(controls.target.x, 14);
});
test("manual rotation pauses auto until explicit resume and repeated stream updates do not restart", () => {
  const { camera, controls, meeting } = setup(false);
  meeting.enter(space);
  meeting.update(1, actors);
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(0.3, actors);
  const halfway = controls.target.x;
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(0.3, actors);
  assert.ok(controls.target.x < halfway);
  assert.ok(
    Math.abs(controls.target.x - 13.3) < 1e-9,
    "same utterance completes its original transition",
  );
  meeting.manualRotate();
  const position = camera.position.clone();
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "two" });
  meeting.update(1, actors);
  assert.ok(camera.position.equals(position));
  assert.equal(meeting.automatic, false);
  meeting.resumeAuto();
  meeting.update(1, actors);
  assert.equal(meeting.automatic, true);
  assert.ok(controls.target.x > 14);
});

test("rapid speaker changes use bounded headings and manual mode is instance-local", () => {
  const first = setup();
  const second = setup();
  first.meeting.enter(space);
  second.meeting.enter(space);
  for (let i = 0; i < 30; i++) {
    first.meeting.setSpeaker({
      kind: i % 2 ? "npc" : "user",
      id: i % 2 ? "npc" : "user",
      utteranceId: String(i),
    });
    first.meeting.update(0.1, actors);
    const orbit = new T.Spherical().setFromVector3(
      first.camera.position.clone().sub(first.controls.target),
    );
    assert.ok(Math.abs(orbit.theta) < 1.2);
  }
  first.meeting.manualRotate();
  assert.equal(second.meeting.automatic, true);
  second.meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "last" });
  second.meeting.update(1, []);
  assert.equal(second.controls.target.x, 14);
});

test("a narrow resize preserves room visibility immediately, before the next transition frame", () => {
  const { camera, meeting } = setup(false);
  meeting.enter(space);
  meeting.update(1, actors);
  meeting.setViewport(600, 900, 240);
  camera.updateMatrixWorld(true);
  for (const x of [10, 18])
    for (const z of [5, 11]) {
      const point = new T.Vector3(x, 0, z).project(camera);
      const px = ((point.x + 1) / 2) * 600;
      assert.ok(px >= 0 && px <= 360, `${px} outside immediately resized viewport`);
    }
});
test("room corners stay in the usable viewport after narrow resize and speaker zoom", () => {
  const { camera, meeting } = setup();
  meeting.enter(space);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  for (const [width, height, right] of [
    [1200, 600, 350],
    [600, 900, 240],
  ]) {
    meeting.setViewport(width, height, right);
    meeting.update(1, actors);
    camera.updateMatrixWorld(true);
    for (const x of [10, 18])
      for (const z of [5, 11])
        for (const y of [0, 2.5]) {
          const point = new T.Vector3(x, y, z).project(camera);
          const px = ((point.x + 1) / 2) * width;
          assert.ok(px >= 0 && px <= width - right, `${px} outside usable width`);
          assert.ok(Math.abs(point.y) <= 1, `${point.y} outside height`);
        }
  }
});
test("legacy renderer camera controls cannot bypass the meeting lock", () => {
  const { camera, controls, meeting } = setup();
  meeting.enter(space);
  meeting.update(1, actors);
  const renderer = Object.create(OfficeRenderer.prototype) as OfficeRenderer;
  Object.assign(renderer, {
    camera,
    controls: { ...controls, update() {} },
    meetingCamera: meeting,
    following: false,
    stopFollowing() {},
    host: { clientWidth: 1200, clientHeight: 600 },
  });
  const position = camera.position.clone();
  renderer.zoom(0.2);
  renderer.focus();
  renderer.showRoom(200, 200);
  renderer.overview(200, 200);
  assert.ok(camera.position.equals(position));
  assert.equal((renderer as unknown as { following: boolean }).following, false);
});

test("renderer enter/rotate/resume/exit restores follow state and wall materials", () => {
  const { camera, controls, meeting } = setup();
  const renderer = Object.create(OfficeRenderer.prototype) as OfficeRenderer;
  const wall = new T.Mesh(new T.BoxGeometry(3, 3, 0.2), new T.MeshStandardMaterial());
  wall.position.set(0, 1, 3);
  const material = wall.material;
  const meetingWalls = new MeetingWallOcclusion();
  const host = { clientWidth: 1200, clientHeight: 600, dataset: {} as Record<string, string> };
  Object.assign(renderer, {
    camera,
    controls: { ...controls, update() {} },
    meetingCamera: meeting,
    following: true,
    meetingWalls,
    meetingWallObjects: [wall],
    furnitureHighlight: new FurnitureHighlight(),
    boardArrival: new BoardArrival(),
    host,
    cursor: { visible: true },
    meetingRightInset: 0,
    overviewDimensions: null,
    setHoveredSeat() {},
    stopFollowing() {},
  });
  const states: boolean[] = [];
  renderer.onMeetingCameraChange = (state) => states.push(state.automatic);
  assert.equal(renderer.enterMeeting(space), true);
  meeting.update(1, actors);
  assert.equal(host.dataset.meeting, "true");
  assert.equal(controls.enableZoom, false);
  renderer.rotateCamera(1);
  assert.equal(renderer.meetingCameraState().automatic, false);
  renderer.resumeMeetingAuto();
  assert.equal(renderer.meetingCameraState().automatic, true);
  const input = renderer as unknown as {
    meetingPointer: { x: number; y: number };
    point(event: PointerEvent, kind: "move"): void;
  };
  input.meetingPointer = { x: 0, y: 0 };
  input.point({ clientX: 20, clientY: 0, buttons: 1 } as PointerEvent, "move");
  assert.equal(renderer.meetingCameraState().automatic, false);
  renderer.resumeMeetingAuto();
  meetingWalls.update(new T.Vector3(0, 1, 7), [new T.Vector3(0, 1, 0)]);
  assert.notEqual(wall.material, material);
  renderer.exitMeeting();
  assert.equal(wall.material, material);
  assert.equal(controls.enableZoom, true);
  assert.equal(host.dataset.meeting, undefined);
  assert.equal((renderer as unknown as { following: boolean }).following, true);
  assert.deepEqual(states, [true, false, true, false, true, true]);
});
