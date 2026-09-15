/** 회의실 좌표 계약: 경계·입구는 타일, 참가자 위치·좌석 ID는 서버 픽셀. */
export const MEETING_SPACE_VERSION = 1;
export type MeetingBounds = { x: number; y: number; width: number; height: number };
export type MeetingPosition = { x: number; y: number; direction: "up" | "down" | "left" | "right" };
export type MeetingSpace = {
  id: string;
  version: number;
  bounds: MeetingBounds;
  entry: { x: number; y: number };
  seatIds: string[];
  standingPositions: MeetingPosition[];
  wallObjectIds: string[];
  wallTileKeys: string[];
};
export function insideMeetingSpace(bounds: MeetingBounds, x: number, y: number) {
  return (
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
  );
}
