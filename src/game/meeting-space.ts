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
  /** 충돌 객체를 유지한 채 생성된 증축 외곽만 그리는 렌더링 전용 표식. */
  generatedAnnexWalls?: Array<{
    id: string;
    col: number;
    row: number;
    type: "room_wall_h";
    display: "horizontal" | "vertical" | "corner" | "hidden";
  }>;
};
export function insideMeetingSpace(bounds: MeetingBounds, x: number, y: number) {
  return (
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
  );
}
