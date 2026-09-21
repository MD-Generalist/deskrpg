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
  // 목표점은 방 중심이 아니라 참가자 구도의 화면 중심이다 — 방 안에만 있으면 된다.
  assert.ok(controls.target.x > 10 && controls.target.x < 18, `목표 x ${controls.target.x}`);
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
    // 카메라가 렌더러에 각 액터의 실제 모습을 묻는다.
    actors: new Map(),
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
/** 사용 가능 화면(전체 폭 − 회의 패널) 안에서의 위치. 0~1 이면 보인다. */
function usableSpot(camera: T.PerspectiveCamera, point: T.Vector3, width: number, right: number) {
  camera.updateMatrixWorld(true);
  const p = point.clone().project(camera);
  return { x: (((p.x + 1) / 2) * width) / (width - right), y: (1 - p.y) / 2 };
}
function assertVisible(
  camera: T.PerspectiveCamera,
  point: T.Vector3,
  width: number,
  right: number,
  label: string,
) {
  const spot = usableSpot(camera, point, width, right);
  assert.ok(spot.x >= 0 && spot.x <= 1, `${label}: 가로 ${spot.x.toFixed(3)} 가 사용 가능 폭 밖`);
  assert.ok(spot.y >= 0 && spot.y <= 1, `${label}: 세로 ${spot.y.toFixed(3)} 가 화면 밖`);
}
/** 두 참가자 몸을 감싸는 상자 꼭짓점 — 회의 구도가 반드시 담아야 하는 것. */
function participantCorners() {
  const corners: T.Vector3[] = [];
  for (const actor of actors)
    for (const dx of [-0.6, 0.6])
      for (const dz of [-0.6, 0.6])
        for (const y of [0, 2.2])
          corners.push(new T.Vector3(actor.x / 32 + dx, y, actor.y / 32 + dz));
  return corners;
}
test("기본 구도는 방이 아니라 참가자를 담고, 화면을 채운다", () => {
  // 옛 구도는 방 네 모서리의 경계 구로 거리를 잡아 8×6 칸 방을 23칸 밖에서 봤다(실측).
  // 이제 주제는 사람이다 — 모두 보이되 화면의 큰 몫을 차지해야 한다.
  const { camera, meeting } = setup();
  meeting.enter(space);
  meeting.update(1, actors);
  assert.equal(meeting.shot, "table");
  for (const corner of participantCorners()) assertVisible(camera, corner, 1200, 350, "참가자");
  // 꽉 찬 구도란 "제한하는 축이 거의 가득" 이다 — 상자를 비스듬히 보므로 가로와 세로 중
  // 어느 쪽이 먼저 차는지는 방 모양에 달렸다. 처음엔 가로 60% 를 단정했다가 세로가 먼저 차는
  // 이 픽스처에서 틀렸다.
  const spots = participantCorners().map((c) => usableSpot(camera, c, 1200, 350));
  const spreadX = Math.max(...spots.map((p) => p.x)) - Math.min(...spots.map((p) => p.x));
  const spreadY = Math.max(...spots.map((p) => p.y)) - Math.min(...spots.map((p) => p.y));
  assert.ok(
    Math.max(spreadX, spreadY) >= 0.75,
    `구도가 헐겁습니다 — 가로 ${(spreadX * 100).toFixed(0)}%, 세로 ${(spreadY * 100).toFixed(0)}%`,
  );
});

test("발언자 구도는 바라보는 쪽 정면에서 상반신으로 당긴다", () => {
  const { camera, controls, meeting } = setup();
  meeting.enter(space);
  meeting.update(1, actors);
  const tableDistance = camera.position.distanceTo(controls.target);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, actors);
  assert.equal(meeting.shot, "speaker:npc:npc");
  const speaker = new T.Vector3(16, 0, 9);
  // npc 는 아래(+z)를 본다 → 카메라는 발언자보다 +z 쪽, 거의 같은 x 에 있어야 정면이다.
  const toCamera = camera.position.clone().sub(speaker).setY(0).normalize();
  assert.ok(toCamera.z > 0.9, `정면이 아닙니다 — 카메라 방향 ${toCamera.toArray()}`);
  const distance = camera.position.distanceTo(controls.target);
  assert.ok(
    distance >= 2.2 && distance < tableDistance * 0.6,
    `발언자 거리 ${distance.toFixed(2)}`,
  );
  assertVisible(camera, new T.Vector3(16, 2.9, 9), 1200, 350, "머리");
  const head = usableSpot(camera, new T.Vector3(16, 2.2, 9), 1200, 350);
  assert.ok(Math.abs(head.x - 0.5) < 0.2, `머리가 화면 가운데에서 벗어났습니다: ${head.x}`);
});

test("위를 보는 발언자는 반대편(−z)에서 잡는다", () => {
  const { camera, meeting } = setup();
  const facingUp = actors.map((a) => (a.kind === "npc" ? { ...a, direction: "up" } : a));
  meeting.enter(space);
  meeting.update(1, facingUp);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, facingUp);
  assert.ok(camera.position.z < 9, `카메라 z ${camera.position.z} — 얼굴 쪽이 아닙니다`);
});

test("발언자 확대 정도: 얼굴 가까이 < 상반신 < 전신 < 테이블 전체", () => {
  const distances: number[] = [];
  for (const speakerFraming of ["face", "upperBody", "fullBody", "table"] as const) {
    const { camera, controls, meeting } = setup();
    meeting.configure({ speakerFraming });
    meeting.enter(space);
    meeting.update(1, actors);
    meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
    meeting.update(1, actors);
    distances.push(camera.position.distanceTo(controls.target));
  }
  assert.ok(
    distances[0] < distances[1] && distances[1] < distances[2] && distances[2] < distances[3],
    distances.join(" < "),
  );
});

function speakerDistance(
  list: ActorSnapshot[],
  speakerFraming: "face" | "upperBody" = "upperBody",
) {
  const { camera, controls, meeting } = setup();
  meeting.configure({ speakerFraming });
  meeting.enter(space);
  meeting.update(1, list);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, list);
  return { camera, distance: camera.position.distanceTo(controls.target) };
}

test("상반신 구도에 옆자리 사람이 들어오면 가슴 위까지 당기고, 옆이 비면 상반신 그대로다", () => {
  // 스테이징 실측: 붙은 좌석에서 발언자와 옆 사람이 투샷으로 잡혔다.
  const neighbor: ActorSnapshot = {
    id: "neighbor",
    kind: "npc",
    name: "Next",
    x: 17 * 32,
    y: 9 * 32,
    direction: "down",
    walking: false,
  };
  const alone = speakerDistance(actors).distance;
  const beside = speakerDistance([...actors, neighbor]);
  const bust = speakerDistance(actors, "face").distance;
  assert.ok(beside.distance < alone - 0.1, `옆자리 ${beside.distance} vs 단독 ${alone}`);
  assert.ok(Math.abs(beside.distance - bust) < 1e-6, "옆자리가 있으면 가슴 위 구도와 같다");
  assertVisible(beside.camera, new T.Vector3(16, 2.9, 9), 1200, 350, "발언자 머리");
  // 방 밖(유리벽 너머)에 있는 사람은 옆자리가 아니다.
  const outside = { ...neighbor, x: 40 * 32 };
  assert.ok(Math.abs(speakerDistance([...actors, outside]).distance - alone) < 1e-6);
});

test("발언 중 '테이블 전체' 설정은 참가자를 모두 담은 채 발언자 쪽으로 돈다", () => {
  const { camera, meeting } = setup();
  meeting.configure({ speakerFraming: "table" });
  meeting.enter(space);
  meeting.update(1, actors);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, actors);
  for (const corner of participantCorners()) assertVisible(camera, corner, 1200, 350, "참가자");
});

test("짧은 발언도 최소 체류 동안 머물고, 끝난 뒤 잠깐 더 머문 다음 테이블로 돌아간다", () => {
  const { meeting } = setup();
  meeting.configure({ minSpeakerDwellSeconds: 1.5, holdAfterSpeechSeconds: 1.2 });
  meeting.enter(space);
  meeting.update(0.1, actors);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "short" });
  meeting.update(0.1, actors); // t=0.2 발언 시작 — 즉시 발언자로
  assert.equal(meeting.shot, "speaker:npc:npc", "발언 시작에는 늦지 않고 반응해야 합니다");
  meeting.setSpeaker(null);
  const at = (t: number) => {
    while (clock < t) {
      meeting.update(0.05, actors);
      clock += 0.05;
    }
    return meeting.shot;
  };
  let clock = 0.2;
  assert.equal(at(1.0), "speaker:npc:npc", "최소 체류(1.5초) 전에 떠났습니다");
  assert.equal(at(1.6), "speaker:npc:npc", "발언이 끝난 뒤 1.2초를 머물지 않았습니다");
  assert.equal(at(2.2), "table");
});

test("다음 발언자가 이어지면 테이블을 거치지 않고 바로 넘어간다(직행 기본값)", () => {
  const { meeting } = setup();
  meeting.configure({ minSpeakerDwellSeconds: 0.5, holdAfterSpeechSeconds: 1.2 });
  meeting.enter(space);
  meeting.update(0.1, actors);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "a" });
  const shots: string[] = [];
  for (let i = 0; i < 10; i++) {
    meeting.update(0.1, actors);
    shots.push(meeting.shot);
  }
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "b" });
  for (let i = 0; i < 10; i++) {
    meeting.update(0.1, actors);
    shots.push(meeting.shot);
  }
  const afterFirst = shots.slice(shots.indexOf("speaker:npc:npc"));
  assert.ok(!afterFirst.includes("table"), `테이블을 거쳤습니다: ${afterFirst.join(",")}`);
  assert.equal(shots.at(-1), "speaker:user:user");
});

test("직행을 끄면 테이블 구도를 거쳐 다음 발언자로 간다", () => {
  const { meeting } = setup();
  meeting.configure({ minSpeakerDwellSeconds: 0.5, directHandoff: false });
  meeting.enter(space);
  meeting.update(0.1, actors);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "a" });
  for (let i = 0; i < 10; i++) meeting.update(0.1, actors);
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "b" });
  const shots: string[] = [];
  for (let i = 0; i < 30; i++) {
    meeting.update(0.1, actors);
    shots.push(meeting.shot);
  }
  const table = shots.indexOf("table");
  const next = shots.indexOf("speaker:user:user");
  assert.ok(table >= 0 && next > table, `순서가 틀렸습니다: ${shots.join(",")}`);
});

test("발언자가 빠르게 바뀌어도 최소 체류가 카메라를 붙잡는다 — 흔들리지 않는다", () => {
  // 옛 단정은 "방향이 ±1.2 rad 안" 이었다. 정면 구도에서는 방향이 발언자의 시선이므로
  // 그 단정은 뜻이 없다. 흔들림의 실체는 구도가 너무 자주 바뀌는 것이다.
  const first = setup();
  const second = setup();
  first.meeting.enter(space);
  second.meeting.enter(space);
  let changes = 0;
  let last = "";
  for (let i = 0; i < 30; i++) {
    first.meeting.setSpeaker({
      kind: i % 2 ? "npc" : "user",
      id: i % 2 ? "npc" : "user",
      utteranceId: String(i),
    });
    first.meeting.update(0.1, actors);
    if (first.meeting.shot !== last) changes += 1;
    last = first.meeting.shot;
  }
  // 3초 동안 1.5초 체류면 발언자 구도는 많아야 세 번 바뀐다(첫 진입 포함).
  assert.ok(changes <= 3, `3초에 구도가 ${changes}번 바뀌었습니다`);
  first.meeting.manualRotate();
  assert.equal(second.meeting.automatic, true);
});

test("발언 중이 아니거나(생각 중) 이름만 같은 발언자는 테이블 구도다 — 식별은 타입 있는 ID", () => {
  const { meeting } = setup();
  meeting.configure({ minSpeakerDwellSeconds: 0, holdAfterSpeechSeconds: 0 });
  meeting.enter(space);
  meeting.update(1, actors);
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(1, actors);
  assert.equal(meeting.shot, "speaker:user:user");
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "thought", phase: "thinking" });
  meeting.update(1, actors);
  assert.equal(meeting.shot, "table", "생각 중은 발언이 아닙니다");
  // 두 참가자의 이름이 모두 "Same" 이다 — 이름으로 찾으면 엉뚱한 사람을 잡는다.
  meeting.setSpeaker({ kind: "user", id: "Same", utteranceId: "three" });
  meeting.update(1, actors);
  assert.equal(meeting.shot, "table");
});

test("같은 발언의 스트림 갱신은 전환을 다시 시작하지 않고, 수동 회전은 자동을 멈춘다", () => {
  const { camera, controls, meeting } = setup(false);
  meeting.enter(space);
  meeting.update(2, actors);
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(0.3, actors);
  const halfway = controls.target.clone();
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(0.3, actors);
  assert.ok(!controls.target.equals(halfway), "전환이 멈췄습니다");
  meeting.update(2, actors);
  const settled = controls.target.clone();
  meeting.setSpeaker({ kind: "user", id: "user", utteranceId: "one" });
  meeting.update(0.3, actors);
  assert.ok(controls.target.equals(settled), "같은 발언 갱신이 전환을 다시 시작했습니다");
  meeting.manualRotate();
  const position = camera.position.clone();
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "two" });
  meeting.update(3, actors);
  assert.ok(camera.position.equals(position));
  assert.equal(meeting.automatic, false);
  meeting.resumeAuto();
  meeting.update(3, actors);
  assert.equal(meeting.automatic, true);
  assert.equal(meeting.shot, "speaker:npc:npc");
});

test("전환하는 모든 프레임에서 발언자가 화면 밖으로 나가지 않는다", () => {
  const { camera, meeting } = setup(false);
  meeting.enter(space);
  meeting.update(2, actors);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  for (let i = 0; i < 30; i++) {
    meeting.update(1 / 30, actors);
    assertVisible(camera, new T.Vector3(16, 1.5, 9), 1200, 350, `프레임 ${i}`);
  }
});

test("좁게 줄여도 그 즉시 참가자가 모두 보인다 — 다음 프레임을 기다리지 않는다", () => {
  const { camera, meeting } = setup(false);
  meeting.enter(space);
  meeting.update(2, actors);
  meeting.setViewport(600, 900, 240);
  for (const corner of participantCorners()) assertVisible(camera, corner, 600, 240, "줄인 직후");
});

test("발언자 구도에서 좁게 줄여도 발언자가 보인다", () => {
  const { camera, meeting } = setup();
  meeting.enter(space);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  for (const [width, height, right] of [
    [1200, 600, 350],
    [600, 900, 240],
  ]) {
    meeting.setViewport(width, height, right);
    meeting.update(1, actors);
    // 서 있는 발언자(좌석 없음)의 상반신은 머리 2.9 에서 가슴 약 1.3 까지다.
    assertVisible(camera, new T.Vector3(16, 2.9, 9), width, right, `${width}×${height} 머리`);
    assertVisible(camera, new T.Vector3(16, 1.4, 9), width, right, `${width}×${height} 가슴`);
  }
});

test("발언자 정면이 벽 너머여도 발언자를 자르지 않고, 옆방 깊이 들어가지 않는다", () => {
  // npc(16,9)가 아래(+z)를 보면 정면 카메라가 남쪽 벽(z=11) 너머로 나간다. 처음 구현은 방 안으로
  // 당기다가 머리를 잘랐다. 벽은 이미 흐려지므로 벽 바로 너머는 괜찮고, 옆방 깊이는 안 된다.
  const { camera, meeting } = setup();
  meeting.enter(space);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, actors);
  assert.ok(
    camera.position.z <= 11 + 1.5 + 1e-6,
    `카메라 z ${camera.position.z.toFixed(2)} — 옆방 깊이`,
  );
  assertVisible(camera, new T.Vector3(16, 2.9, 9), 1200, 350, "머리");
  assertVisible(camera, new T.Vector3(16, 1.4, 9), 1200, 350, "가슴");
});

test("좌석에 앉은 발언자는 좌석 위치와 앉은 키로 잡는다", () => {
  const { camera, meeting } = setup();
  meeting.enter(space);
  meeting.setSeats([
    { x: 16.2, z: 9.1 },
    { x: 12, z: 7 },
  ]);
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, actors);
  // 앉은 머리(약 2.0)가 화면 위쪽 절반 안에 있어야 한다.
  const head = usableSpot(camera, new T.Vector3(16.2, 2.0, 9.1), 1200, 350);
  assert.ok(head.y > 0 && head.y < 0.5, `앉은 머리 세로 ${head.y.toFixed(2)}`);
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
    // The camera now frames the room's seats, so enterMeeting reads them.
    seats: [],
    // …and asks the renderer what each actor actually looks like.
    actors: new Map(),
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

// ---------------------------------------------------------------------------
// 렌더러가 넘기는 실제 모습 — 짐작하지 않는다

/** 앉은 npc: 좌석(16,9)에 앉아 +x(오른쪽)를 본다. 앉은 몸은 1.5칸 높이다. */
function seatedPresenter(yaw = Math.PI / 2) {
  return (actor: ActorSnapshot) =>
    actor.id === "npc"
      ? { box: new T.Box3(new T.Vector3(15.7, 0, 8.7), new T.Vector3(16.3, 1.5, 9.3)), yaw }
      : null;
}

test("실제 몸 방향을 따른다 — 스냅숏이 '아래' 라도 몸이 오른쪽을 보면 오른쪽에서 잡는다", () => {
  // 로컬 실측에서 드러난 결함: 앉은 사람은 좌석 방향을 보는데, 스냅숏 방향은 좌석으로 걸어 들어갈
  // 때의 마지막 방향이라 카메라가 옆에서 잡았다.
  const { camera, meeting } = setup();
  meeting.setPresenter(seatedPresenter());
  meeting.enter(space);
  meeting.update(1, actors); // actors 의 npc 스냅숏 방향은 "down"
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
  meeting.update(1, actors);
  const toCamera = camera.position
    .clone()
    .sub(new T.Vector3(16, 0, 9))
    .setY(0)
    .normalize();
  assert.ok(
    toCamera.x > 0.9,
    `몸이 향한 쪽(+x)이 아닙니다: ${toCamera.toArray().map((v) => v.toFixed(2))}`,
  );
});

test("상반신은 실제 키로 잡는다 — 머리는 보이고 발은 잘린다, 전신은 발까지 보인다", () => {
  for (const [speakerFraming, feetVisible] of [
    ["upperBody", false],
    ["fullBody", true],
  ] as const) {
    const { camera, meeting } = setup();
    meeting.configure({ speakerFraming });
    meeting.setPresenter(seatedPresenter());
    meeting.enter(space);
    meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
    meeting.update(1, actors);
    assertVisible(camera, new T.Vector3(16, 1.5, 9), 1200, 350, `${speakerFraming} 머리`);
    const feet = usableSpot(camera, new T.Vector3(16, 0, 9), 1200, 350);
    assert.equal(
      feet.y >= 0 && feet.y <= 1,
      feetVisible,
      `${speakerFraming} 발 세로 ${feet.y.toFixed(2)}`,
    );
    const head = usableSpot(camera, new T.Vector3(16, 1.3, 9), 1200, 350);
    assert.ok(
      Math.abs(head.x - 0.5) < 0.15,
      `${speakerFraming}: 발언자가 가운데에 있지 않습니다 ${head.x.toFixed(2)}`,
    );
  }
});

test("진단은 발언자를 어디서 못 찾았는지 말한다", () => {
  const { meeting } = setup();
  meeting.configure({ minSpeakerDwellSeconds: 0, holdAfterSpeechSeconds: 0 });
  meeting.enter(space);
  meeting.update(1, actors);
  assert.equal(meeting.diagnostics.speaker, "none");
  meeting.setSpeaker({ kind: "npc", id: "ghost", utteranceId: "a" });
  meeting.update(1, actors);
  assert.equal(meeting.diagnostics.speaker, "no-actor");
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "b", phase: "thinking" });
  meeting.update(1, actors);
  assert.equal(meeting.diagnostics.speaker, "not-speaking");
  const outside = actors.map((a) => (a.kind === "npc" ? { ...a, x: 40 * 32 } : a));
  meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "c" });
  meeting.update(1, outside);
  assert.equal(meeting.diagnostics.speaker, "outside-room");
  meeting.update(1, actors);
  assert.deepEqual(meeting.diagnostics, { shot: "speaker:npc:npc", speaker: "found", error: null });
});

test("발언자 구도 계산이 던지면 샷을 바꾸지 않고, 다음 프레임에 다시 시도한다", () => {
  // 예전에는 샷 이름을 먼저 바꾼 뒤 계산해, 던지면 이름은 '발언자' 인데 화면은 테이블에 멈췄다.
  const { meeting } = setup();
  let broken = false;
  meeting.setPresenter(() => {
    if (broken) throw new Error("rig not ready");
    return null;
  });
  meeting.configure({ minSpeakerDwellSeconds: 0, holdAfterSpeechSeconds: 0 });
  meeting.enter(space);
  meeting.update(1, actors);
  assert.equal(meeting.shot, "table");
  broken = true;
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    meeting.setSpeaker({ kind: "npc", id: "npc", utteranceId: "one" });
    meeting.update(1, actors);
    meeting.update(1, actors);
  } finally {
    console.error = original;
  }
  assert.equal(meeting.shot, "table", "계산이 실패한 샷으로 이름만 넘어가지 않는다");
  assert.equal(meeting.diagnostics.error, "rig not ready");
  assert.equal(errors.length, 1, "같은 오류를 매 프레임 찍지 않는다");
  broken = false;
  meeting.update(1, actors);
  assert.equal(meeting.shot, "speaker:npc:npc");
  assert.equal(meeting.diagnostics.error, null);
});
