import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { OfficeRenderer } from "./office-renderer";
import { FurnitureHighlight } from "./furniture-highlight";
import { BoardArrival } from "./office-kanban";

type SeatTarget = { owner: T.Object3D; action: { x: number; z: number } };
function fixture() {
  const scene = new T.Scene();
  const furnitureHighlight = new FurnitureHighlight(scene);
  const boardArrival = new BoardArrival();
  const renderer = Object.assign(Object.create(OfficeRenderer.prototype), {
    scene,
    furnitureHighlight,
    boardArrival,
    hoveredSeat: null,
    selectedSeat: null,
    meetingCamera: { active: false },
  }) as {
    hoveredSeat: SeatTarget | null;
    selectedSeat: SeatTarget | null;
    setHoveredSeat(target: SeatTarget | null): void;
    setSelectedSeat(target: SeatTarget | null): void;
    cancelBoardIntent(): void;
    setMeetingEntryState(status: string): void;
    enterMeeting(): boolean;
    point(event: PointerEvent, kind: "down"): void;
    meetingCamera: { active: boolean };
  };
  const seat = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
  const board = new T.Mesh(new T.BoxGeometry(2, 2, 0.1), new T.MeshBasicMaterial());
  scene.add(seat, board);
  return { renderer, scene, seat, board, furnitureHighlight, boardArrival };
}

test("선택 좌석은 호버가 떠난 뒤에도 단일 초록 오버레이로 유지된다", () => {
  const { renderer, seat, scene, furnitureHighlight } = fixture();
  const target = { owner: seat, action: { x: 1, z: 1 } };
  renderer.setSelectedSeat(target);
  renderer.setHoveredSeat(target);
  renderer.setHoveredSeat(null);
  assert.equal(furnitureHighlight.group.visible, true);
  assert.equal(furnitureHighlight.group.children.length, 1);
  assert.equal(scene.children.filter((child) => child instanceof T.Group).length, 1);
  renderer.setSelectedSeat(null);
  assert.equal(furnitureHighlight.group.visible, false);
});

test("보드 호버 이후 같은 좌석으로 돌아오면 좌석 오버레이를 복원한다", () => {
  const { renderer, seat, board, furnitureHighlight } = fixture();
  const target = { owner: seat, action: { x: 1, z: 1 } };
  renderer.setSelectedSeat(target);
  furnitureHighlight.highlight(board);
  renderer.setHoveredSeat(target);
  const overlay = furnitureHighlight.group.children[0] as T.Mesh;
  assert.equal(overlay.geometry, seat.geometry);
});

test("회의 이동 시작과 직접 진입은 보드 도착 의도를 취소한다", () => {
  const { renderer, boardArrival } = fixture();
  boardArrival.start(1, 1, 0);
  renderer.cancelBoardIntent();
  assert.equal(boardArrival.update({ x: 1, y: 1, walking: false }, 10), false);
  boardArrival.start(1, 1, 0);
  assert.equal(renderer.enterMeeting(), false);
  assert.equal(boardArrival.update({ x: 1, y: 1, walking: false }, 10), false);
});

test("회의 중 보드 클릭은 레이 판정과 이동을 시작하지 않는다", () => {
  const { renderer, boardArrival } = fixture();
  renderer.meetingCamera.active = true;
  renderer.point({ button: 0 } as PointerEvent, "down");
  assert.equal(boardArrival.update({ x: 1, y: 1, walking: false }, 10), false);
});

test("회의 진입 이동 중에는 새 보드 클릭도 차단하고 취소 후 해제한다", () => {
  const { renderer } = fixture();
  renderer.setMeetingEntryState("walking");
  Object.assign(renderer, {
    bridge: {
      editor() {
        throw new Error("board input reached");
      },
    },
  });
  renderer.point({ button: 0 } as PointerEvent, "down");
  renderer.setMeetingEntryState("cancelled");
  assert.throws(() => renderer.point({ button: 0 } as PointerEvent, "down"), /board input reached/);
});
