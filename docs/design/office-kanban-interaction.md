# 사무실 게시판과 좌석 호버

## 공통 동작

- 다섯 오피스의 벽면에 스타일별 게시판을 배치한다. 크리에이티브의 기존 벽 갤러리는 같은 위치의 칸반 게시판으로 대체한다.
- 등록 위치/재질은 OFFICE_BOARD_STYLES, 접근 경로는 boardApproach, 도착 판정은 BoardArrival로 분리한다. 동작은 맵별로 복제하지 않는다.
- 호버 시 형상에 색상 강조, 클릭 시 이동, 도착 후 기존 칸반 모달을 한번 연다. 권한/게이트웨이 확인은 기존 모달 경로를 유지한다.
- 다른 위치/인물 클릭, WASD/방향키/Escape, 맵교체, 60초 초과, renderer해제로 예약을 취소한다.
- FurnitureHighlight는 의자/소파 원본 재질을 수정하지 않고 월드행렬과 geometry를 빌려 강조한다. 정적 배치가 남긴 숨김 seatPickProxy도 지원한다. overlay는 raycast를 방해하지 않는다.

## 검증

- 5개 맵의 실제 spawn에서 게시판 접근 경로 검증.
- 미도착/이동중/1회도착/취소/시간초과 검증.
- 부모변환/복합소파/원재질과 geometry 소유권 보존 검증.
- verify-office-scene.cjs --interactions로 실제 raycast와 도착 callback 검증. 크리에이티브: seatHover/sofaHover/boardHover=true, before0/opened1.
- 실제 사용자 세션을 방해하지 않도록 스테이징 확인은 별도 탭에서 진행한다.
