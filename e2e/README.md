# E2E — 브라우저에서 실제 NPC 대화를 검증한다

## 실제 맵 회의: Hermes 없이 두 사람 검증

`meeting-spatial.spec.ts`는 독립된 Chrome browser context 두 개를 사용한다. 기존 사용자
소켓을 끊지 않도록 매번 합성 계정 두 개, 캐릭터 두 개, 새 공개 채널을 API로 만든다.
등록 시 앱이 만드는 기본 프로젝트도 해당 합성 계정에 남는다. **버릴 수 있는 로컬 DB에서만**
실행한다. 기존 사용자 데이터는 지우지 않으며 테스트 데이터도 자동 삭제하지 않는다.

```bash
DESKRPG_E2E_ALLOW_SEED=isolated-local \
DESKRPG_E2E_BASE_URL=http://localhost:3040 \
DESKRPG_E2E_LOGIN_ID=<isolated-admin> \
DESKRPG_E2E_PASSWORD=<isolated-admin-password> \
npx playwright test e2e/meeting-spatial.spec.ts
```

명시적 seed opt-in이 없으면 skip하며, loopback 이외 호스트는 거부한다. 관리자 API 계정,
가입 허용, 기본 그룹, 공식 tech 템플릿과 이미 실행 중인 서버가 필요하다. 서버를 시작하거나
재시작하지 않는다. 설치된 Chrome의 headless 모드만 사용하고 브라우저를 내려받지 않는다.
서로 다른 browser context는 같은 localhost에서도 쿠키가 분리된다.

검증 범위: 실제 `player:move` 이후 `meeting:join`과 서버의 단일 참가자 승인, 원래
canvas 유지, 입장만으로 AI가 시작되지 않음, 두 사용자에게 같은 서버 좌석 상태, 서로 다른
실제 좌석, 개인 카메라 수동 회전/자동 복귀, 모바일 퇴장 버튼, 개인 퇴장/재입장,
준비 화면의 사람끼리 채팅과 참가 전·퇴장 후 사용자에게 회의 채팅이 전달되지 않음.
웹소켓 이벤트는 관찰만 하며 앱 상태·이동·회의 이벤트를 주입하지 않는다.
`meeting-websocket-evidence` 첨부 파일에 송수신 순서와 좌석 상태를 남긴다.

Hermes가 필요한 NPC 집결 → 브로커 1회 실행 → 실제 발언 스트림/중지/복귀는 이 테스트의
통과로 검증되지 않는다. 공식 다섯 맵·legacy/Tiled의 좌표 보존과 정규화 멱등성도 별도
단위 테스트/맵 검증 대상이며 두 사용자 상세 시나리오는 tech 맵 한 개만 실행한다.

`DESKRPG_E2E_MEETING_MATRIX=1`을 추가하면 공식 맵 다섯 개와 legacy/Tiled annex의 실제
UI 진입·원본 canvas·착석·개인 퇴장을 순차 확인한다. 합성 계정 한 개와 신규 채널 일곱 개를
추가 생성한다. 공식 템플릿은 현재 코드의 기본 맵 스냅샷으로 만들고, legacy/Tiled 호환성
템플릿도 테스트가 직접 생성한다. 오래된 템플릿 시드에 의존하지 않는다. 맵별 화면과 웹소켓
첨부 파일을 남기고, 한 맵의 실패가 나머지 맵의 실행을 생략하게 하지 않는다.
legacy에서는 annex까지의 긴 도보 중 실제 취소 버튼을 누른 뒤, 회의 join이 발송되지
않았음을 확인하고 다시 진입한다. 취소 클릭을 먼저 대기시켜 짧은 UI 상태의 관찰 지연을 줄인다.

Tiled 합성 템플릿의 바닥 GID는 실제 tileset 정의와 맞아야 한다. `tilesets: []`인 빈 맵은
바닥도 0으로 시드한다. 정의 없는 GID 1로 채우면 회의 진입 전에 Phaser 맵 로딩이 실패한다.
성공한 맵의 캡처도 보관하려면 `--reporter=list,html`과 `PLAYWRIGHT_HTML_OPEN=never`를 사용한다.
보고서에는 합성 계정의 요청·메시지가 포함될 수 있으므로 공개 저장소에 올리지 않는다.

단위 테스트(`npm run test`, node:test)는 어댑터·엔진의 계약을 고정한다. 이 스위트는 그 위에서
**사람이 실제로 밟는 경로**를 검증한다 — 로그인한 채로 맵에 들어가, NPC 옆까지 걸어가, 말을
걸고, 살아 있는 Hermes 게이트웨이로부터 답을 받는 것까지.

여기 있는 회귀는 단위 테스트로는 잡히지 않았다. 어댑터는 처음부터 옳았고, 결함은 그것을
소비하는 쪽에 있었다.

## 실행

```bash
npm run dev          # 별도 터미널. 로컬 Hermes 게이트웨이도 떠 있어야 한다.
npm run test:e2e
```

## 전제

- `npm run dev` 가 `localhost:3000` 에 떠 있을 것
- 로컬 Hermes 게이트웨이가 살아 있고, 개발 DB 에 **Hermes 프로필이 묶인 NPC** 가 최소 하나 있을 것
- 개발 계정이 존재할 것

환경변수로 바꿀 수 있다:

| 변수                   | 기본값                  |
| ---------------------- | ----------------------- |
| `DESKRPG_E2E_BASE_URL` | `http://localhost:3000` |
| `DESKRPG_E2E_LOGIN_ID` | `devadmin`              |
| `DESKRPG_E2E_PASSWORD` | `deskrpg-e2e-2026`      |
| `DESKRPG_E2E_NPC`      | `단비`                  |

## CI 에 넣지 않은 이유

살아 있는 Hermes 게이트웨이와 시드된 DB 를 요구하고, 둘 다 CI 에 없다. `npm run test` 는 그대로
순수 단위 테스트로 남는다.

## 이 하네스를 만들며 실측한 함정 세 가지

기록해 두지 않으면 다음 사람이 같은 자리에서 같은 시간을 쓴다.

**1. 기본 주소는 `localhost`; 두 계정 검증에는 명시적으로 허용한 `127.0.0.1`을 쓴다.**
브라우저에게 이 둘은 서로 다른 origin 이고, Next dev 서버는 `allowedDevOrigins` 에 없는
origin 의 dev 자원 요청을 막는다. 그러면 RSC 페이로드가 끝내 도착하지 않아 React 가 hydrate
전에 멈춰 선다 — **콘솔 에러 0, 실패한 요청 0, 청크는 21개 전부 200**. 화면에는 "로딩 중..."
만 남는다. 실측: 같은 서버에 `127.0.0.1` 로 붙으면 fiber=0/input=0, `localhost` 면 fiber=2/input=2.

UI2 다중 사용자 검증을 위해 `next.config.ts`의 `allowedDevOrigins`에 루프백 주소
`127.0.0.1`만 추가했다. 설정 변경 후 dev 서버를 재시작해야 한다. Chrome에서
`localhost:<port>`와 `127.0.0.1:<port>`를 각각 열면 쿠키가 분리되어 서로 다른
사용자로 같은 채널에 접속할 수 있다. 같은 hostname의 두 탭은 쿠키를 공유하므로
두 계정 검증에 쓰지 않는다. 프로덕션 CORS·인증 정책을 완화하는 설정은 아니다.
근거: [Next.js allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

**2. headed 로 돌리면 창이 가리는 순간 게임이 멈춘다.**
Chrome 은 가려진(occluded) 창의 `requestAnimationFrame` 을 초당 1프레임으로 스로틀한다.
Phaser 루프가 사실상 멈춰 캐릭터가 NPC 에게 걸어가지 못하고, 테스트는 "대화창이 안 열린다"는
엉뚱한 실패로 나타난다. `document.visibilityState` 는 그때도 `"visible"`, `document.hasFocus()`
는 `true` 라 코드로는 감지되지 않는다. 그래서 `waitForGameLoop()` 이 상태 플래그가 아니라
**프레임을 직접 센다** — 실패 원인을 그 자리에서 이름 붙이기 위해서다. headless 에는 가릴 창이
없으므로 기본값은 headless 다.

**3. 소켓 서버 코드는 HMR 로 갱신되지 않는다.**
`npm run dev` 는 `npx tsx dev-server.ts` 이고 watch 가 없다. Next 페이지는 HMR 로 갱신되지만
`src/server/socket-handlers.ts` 같은 서버 코드는 **재시작해야** 반영된다. 이 사실을 모르면
"고쳤는데 그대로다" 혹은 더 나쁘게 "버그를 되살렸는데 테스트가 통과한다"는 잘못된 결론에
도달한다 — 실제로 이 하네스의 첫 뮤테이션 검증이 그렇게 헛돌았다.

## 칸반·크론 수동 확인 절차 (자동화 안 됨)

칸반·크론은 살아 있는 Hermes 게이트웨이 + `deskrpg-hermes-plugin` ≥ 0.6.0 이 있어야 끝까지 확인된다.
단위 테스트는 가짜 플러그인 서버(`src/lib/hermes/fake-plugin-server.ts`)로 계약만 고정하므로,
릴리스 전에 스테이징(`test.deskrpg.com`)에서 아래를 눈으로 확인한다.

1. 채널 설정에서 게이트웨이를 연결한다 → 헤더의 칸반 버튼이 열리고 "플러그인 업데이트 필요" 안내가 **없어야** 한다.
2. 카드를 만들어 출근 중인 NPC 에게 배정한다 → 몇 초 안에 `running` 열로 옮겨가고 맵의 그 NPC 옆에 작업 중 표시가 뜬다.
3. 카드가 끝나면 사무실 방에 "카드를 완료했습니다: …" 알림이 담당 NPC 이름으로 올라온다(막히면 "막혔습니다").
4. 크론 화면에서 NPC 를 골라 크론을 만들고 "지금 실행" 을 누른다 → 즉시 돌아오고, 끝나면 그 방에 결과 본문이 게시된다.
5. 같은 NPC 가 출근한 다른 채널에서 그 크론이 **읽기 전용**으로 보이는지 확인한다.
