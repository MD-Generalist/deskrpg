# 맵 회의 소켓·공간 계약

소켓의 기존 로그인 인증과 채널 참여 권한을 사용한다. 클라이언트가 보낸 좌표로 참가를 승인하지 않는다.
다음 필드는 기존 회의 이벤트에 추가되며 토큰·Hermes 원문 설정을 포함하지 않는다.

## 입장 전 상태 조회

`meeting:availability` 입력은 `{channelId: string}`이다. 같은 채널에 접속하고 참여 권한이 있는 요청자에게만
같은 이름의 이벤트로 `{channelId, active: boolean}`을 반환한다. 회의 내용 구독이나 참가를 만들지 않는다.
진행 중 토론 또는 NPC 집결/준비 완료 상태이면 active다. 사람끼리 준비 화면만 연 상태는 AI 진행 상태가 아니다.
잘못된 channelId 형식은 무시하고 접근 거절은 기존 `channel:access-denied` 경로를 따른다.

## 참가와 공간 상태

`meeting:join` 입력은 `{channelId, characterName?, appearance?}`를 유지한다. 서버의 실제 위치가 회의실 밖이면
`meeting:error`의 `{error: "not_in_meeting_space"}`로 거절한다. 채널 권한 거절은 기존 접근 거절 이벤트를 따른다.
승인된 `meeting:state`는 기존 participants/messages/discussion/isInitiator에 `spatial`을 추가한다.
`meeting:leave {channelId}`는 해당 요청자의 참여만 해제하며 별도 성공 응답은 없다.

`meeting:spatial-state`는 회의 참가 룸 전용이며 `meeting:state.spatial`과 같은 형태다:

- `channelId`, `spaceId`: 문자열. `generation`: 서버 호출 세대 숫자.
- `phase`: `idle | assembling | ready | returning | blocked`.
- `participants`: `{actorId, kind: player | npc, state: walking | seated | standing | returning | blocked,
seatId: string | null, target: {x,y} | null}[]`. target은 서버 픽셀 단위다.
- `failure`: `null` 또는 `{actorId, reasonCode}`. 화면은 이유 코드로 현지화하며 실패를 도착으로 처리하지 않는다.

사람 식별은 소켓 연결 ID와 별개인 사용자 ID를 따른다. 오래된 세대의 도착은 새 준비를 완료하지 못한다.
공간 phase와 토론 mode(`auto | manual | directed`)는 서로 다른 필드다.

## 유효 맵

`MeetingSpace.bounds`와 `entry`는 타일 단위, 좌석 ID와 서 있을 위치는 서버 픽셀 단위다. 한 타일은 32픽셀이다.
유효 맵과 공간 정보를 분리 적용하지 않는다. Tiled 오브젝트 식별자는 `layerId:objectId`다.
선택적인 `generatedAnnexWalls`는 `{id,col,row,type:room_wall_h,display:horizontal|vertical|corner|hidden}[]`다.
생성 증축벽의 표시만 지정하며 이동 권한·충돌 계약이 아니다. 현재 객체의 ID·좌표·타입이 일치할 때만 적용하고,
표식이 없는 기존 맵의 벽은 생성벽이라고 추정하여 숨기지 않는다.
