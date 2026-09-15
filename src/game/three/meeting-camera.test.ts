import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { MeetingCamera } from "./meeting-camera";
import { OfficeRenderer } from "./office-renderer";
import { MeetingWallOcclusion } from "./meeting-wall-occlusion";
import type { MeetingSpace } from "../meeting-space";
import type { ActorSnapshot } from "./bridge";

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
