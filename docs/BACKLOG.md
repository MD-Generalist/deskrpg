# DeskRPG 백로그

다음에 할 일의 단일 소스. `docs/` 는 `.gitignore` 에 있으므로 이 파일은 **로컬 전용**이다
(개발 메타 비공개 원칙).

항목은 **실증된 것만** 올린다. 추측은 올리지 않고, 확인해서 결함이 아니면 지운다.

---

## ~~회의 자동복귀 타이머가 사용자 조작 중에 발화한다~~ — 해결 (2026-08-22 · master b77cdca7)

- [x] **해결.** manual 라운드 끝의 재장전이 `this.autoResumeTimer` 에 곧바로 대입해 이전 핸들을
  잃었고, 그 고아가 사용자가 아직 수동으로 회의를 몰고 있는 동안 만료돼 auto 로 튀었다.
  재장전 직전에 `clearAutoResumeTimer()` 를 부르는 한 줄로 닫았다.
  - **취소를 `nextTurn()` 이 아니라 재장전 지점에 둔 이유:** 핸들이 덮이는 자리는 여기 한 곳뿐인데
    대기를 푸는 경로는 넷이고 늘어난다. 경로마다 취소를 심는 방식이 바로 이 결함을 만들었다 —
    `setMode`·`directSpeak`·`stop` 은 전부 취소하는데 `nextTurn` 만 빠져 있었다.
  - **두 곳 다 고치는 안은 기각했다.** 처음엔 `nextTurn()` 에도 취소를 넣었는데, 그러면 두
    수정이 서로를 덮어 **어느 뮤테이션도 테스트를 빨갛게 만들지 못했다**. 둘을 모두 제거해야만
    빨개졌다 — 즉 한쪽은 검증되지 않는 무게였다. 취소 하나, 뮤테이션 하나, 빨간 테스트 하나로 맞췄다.
  - **재현에 세 번의 `nextTurn` 이 필요하다**는 사실을 테스트 주석에 남겼다. 두 번으로 시도한
    첫 재현이 빈 결과를 내 하마터면 "재현 불가"로 닫을 뻔했다.
  - 회귀 테스트: `channel-runtime.test.ts` — 마지막 정상 타이머가 아직 대기 중일 때 회의를
    끝내도록 시간을 배치해, **고아만** 관측되게 했다. 사용자가 손을 뗀 뒤의 auto 복귀는 정상
    동작이므로 그것까지 실패로 잡으면 안 된다(첫 테스트가 그 함정에 빠져 수정본에서도 빨갰다).

---

## ~~빈 응답·평범한 에러에서 스트리밍 말풍선이 닫히지 않는다~~ — 해결 (2026-08-22 · master e5350b43)

- [x] **해결.** 다섯 갈래 전부에서 `onTurnEnd` 를 부른다. `meta.reason` 으로 갈래를 구분한다 —
  `empty_after_mention` / `empty_response` / `adapter_error` / `timeout:<kind>`.
  - **증상이 하나 더 있었다:** 같은 `done:true` 가 `setCurrentSpeaker(null)` 도 푼다
    (`MeetingRoom.tsx` 의 `handleNpcStream`). 말풍선뿐 아니라 **"발언 중" 표시도** 이미 말을
    끝낸 참가자에 걸린 채 남아 있었다.
  - **거짓말하던 주석을 고쳤다.** "중단이든 아니든 항상 호출되어야"는 사실이 아니었고, 다음
    사람을 클라이언트 쪽으로 잘못 보낼 문장이었다.
  - `SpeakOutcome` 이 `empty`·`error` 갈래에도 `partialText` 를 싣는다(예전엔 타임아웃만).
    말풍선이 닫힐 때 이미 스트리밍된 내용 그대로 확정되고, 마지막 순간에 비어 버리지 않는다.
  - **기존 테스트 2개가 깨졌고, 그게 맞다.** 둘 다 `onTurnEnd` 를 "발언했다"의 대용으로 쓰고
    있었는데 이제 그 신호는 "말풍선을 닫았다"도 뜻한다. `meta.aborted` 로 거르게 고쳤고,
    한쪽은 단언 메시지가 옛 규칙을 그대로 주장하고 있어 문구를 돌려 쓰지 않고 없앴다.
  - 뮤테이션 2건 검증: empty 갈래 호출 제거 → 2개 적색, error 갈래를 타임아웃 전용으로
    되돌림 → 1개 적색.

---

## ~~`releaseWait()` 가 도착을 기억하지 않는다 (lost wakeup)~~ — 해결 (2026-08-22 · master 1df924f5)

- [x] **해결.** `releaseWait()` 가 대기 미설치 상태의 해제를 **래치**로 기억하고,
  `armWait()` 이 그것을 소비해 곧바로 통과한다. **`directed` 특례(`pendingCount() === 0`)는
  함께 제거했다** — 원시형을 고치니 지킬 것이 남지 않았다(백로그가 예상한 그대로).
  - **카운터가 아니라 래치인 이유:** 해제 두 번이 대기 두 번을 통과시키면 manual 회의가
    사실상 auto 처럼 돈다.
  - **그 구분을 검증하는 첫 테스트는 실패할 수 없는 것이었다.** `mockAdapter` 가 폴링·발언
    대본 큐를 공유해 두 번째 라운드부터 PASS 로 읽히고, 그러면 어느 의미에서도 턴이 더 안 돌아
    결과가 같다. `alwaysRaisesAndSpeaks` 로 바꾸자 갈렸다 — 래치 2턴, 카운터 3턴.
  - **넣지 않은 것:** `run()` 의 래치 초기화. `stop()` 이 래치를 남길 것 같았으나 실측은
    `false` 였고, 어떤 뮤테이션도 정당화하지 못하는 코드는 무게다.
  - 뮤테이션 2건: 래치 소비 제거 → 3개 적색, 래치를 카운터로 → 신규 1개 적색.

---

## ~~`npm run test` 가 추적되지 않은 테스트 파일을 실행하지 않는다~~ — 해결 (2026-08-22 · master ed5dec5e)

- [x] **해결.** 글로브를 따옴표로 감싸 sh 가 아니라 node 가 전개하게 했다.
  `"test": "tsx --test \"src/**/*.test.ts\" \"src/**/*.test.js\""`.
  - **두 번의 우회가 다 불필요했다.** 원래 결함은 따옴표 없는 글로브를 sh 가 globstar 없이
    전개한 것(`src/*/*.test.ts` 로 축소 → 394개 누락)이었고, `git ls-files` 로 바꾼 것은 깊이는
    고쳤지만 인덱스에 묶여 미추적 파일을 놓쳤다. 둘 다 **셸을 우회하려던 것**이었는데,
    node 의 `--test` 는 v21 부터 `**` 를 이해한다. 따옴표 하나면 깊이와 미추적이 함께 해결된다.
  - 덤: git 저장소가 아닌 환경(tarball·export)에서도 돈다 — 실측 확인.
  - **실증:** 미추적 probe 파일 추가 시 646 → 647. git 아닌 임시 디렉토리에서도 정상 실행.

---

## ~~`NpcRuntime` 이 부모 모듈에서 타입을 가져온다~~ — 해결 (2026-08-22 · master 74cdbfb0)

- [x] **해결.** `EngineParticipant` 를 새 `src/lib/conversation/types.ts` 로 내렸다.
  `channel-runtime` 은 재export 로 남겨 호출부(meeting-discussion·테스트·껍데기) 무변경.
  - `turn-policy.ts` 옆에 두지 않았다 — 그 파일은 스스로 "순수 함수, 어댑터도 소켓도 DB도
    모른다"고 선언하고, 어댑터를 든 타입은 그 규약을 깬다.
  - **함정 하나:** `export type { X } from "./types"` 는 재export 만 하고 **지역 바인딩을
    만들지 않는다.** `channel-runtime` 자신이 그 타입을 쓰므로 `import type` 을 따로 둬야 한다
    (타입체커가 바로 잡아냈다).
  - 정의를 옮기자 `NpcAdapter` import 가 죽어(주석에만 남음) 함께 제거했다.

---

## ~~NPC 의 실패 상태를 NPC 가 아니라 채널이 운전한다~~ — 해결 (2026-08-22 · master 아래 커밋)

- [x] **해결.** `takeTurn()` 이 네 반환 지점에서 스스로 카운터를 갱신하고
  `noteSuccess`/`noteFailure` 는 private 이 됐다.
  - `resetFailures()` 만 public 으로 남겼다 — "회의가 새로 시작한다"는 NPC 가 알 수 없는
    사실이라 진짜로 바깥의 몫이다. `note*` 짝과 이름을 갈라 그 차이를 드러냈다.
  - **컴파일러가 세 호출부를 전부 짚었다.** 이제 갱신을 빠뜨리면 조용히 어긋나는 카운터가
    아니라 타입 에러가 된다 — 2단계에서 동시 발언이 `speak()` 를 여럿 돌릴 때가 위험 지점이었다.
  - 기존 테스트 **무수정** 646 통과 — Acceptance 그대로.

---

## ~~2단계 — 자유채팅에서 NPC 동시 발언~~ — 완료 (2026-08-22 · master a4c24b11)

- [x] **완료.** 16커밋. 별도 런타임(`OpenChatRuntime`)으로 붙였다 — 아래 비용 실측이 맞았고 `FloorController` 교체안은 폐기했다. 맵 채팅(`chat:send`)에 NPC 가 참여하지 못한다. 회의방은 한 번에 한 명이지만 자유채팅은 동시 발언이어야 한다는 것이 확정된 방향이다.**
  - **현재 상태:** `src/server/socket-handlers.ts` 의 `chat:send` 는 플레이어 메시지를
    히스토리에 넣고 방에 브로드캐스트할 뿐, NPC 를 깨우는 경로가 없다. `channels` 테이블에
    타입 컬럼도 없다 — 채널은 곧 맵이고 회의는 그 안에서 잠깐 생겼다 사라진다.
  - **비용 실측(최종 리뷰):** 스펙은 "`FloorController` 교체만으로 붙는다"고 적었으나
    성립하지 않는다. 최소 다음이 열린다:
    1. `FloorController` 인터페이스 추출 — 지금은 `channel-runtime.ts` 생성자가
       `new MeetingFloorController(...)` 를 하드코딩한다. 주입점도 공유 타입도 없다.
    2. `FloorDecision` 복수화 — `{kind:"grant"; npcId}` / `{kind:"speaker"; npcId}` 는
       동시 발언을 표현할 수 없다. `npcIds: string[]` 로 넓히면 소비처 세 갈래가 전부 바뀐다.
    3. `FloorInbox.take()` 다중 드레인 — 지금은 하나만 돌려준다.
    4. `this.current: NpcRuntime | null` 과 `abortCurrentTurn()` 집합화(스펙 §9 가 명시적으로 미룬 것).
    5. `lastSpeakerId` 단수, `speak()` 순차 await → `Promise.all`.
  - **새로 필요한 것 — author gate.** 회의방은 참가자가 명시적으로 초대된 닫힌 방이라
    게이트가 필요 없었다. 맵 채팅은 **열린 공간**이라 Buzz 의 `owner-only` 기본값
    (`wiki/concepts/에이전트를-봇이-아닌-멤버로.md`)에 해당하는 것이 필요하다 — 없으면
    NPC 끼리 무한히 대화하는 사고가 기본 설정으로 열린다.
  - **Direction:** 브레인스토밍 → 스펙 → 플랜. 위 5개 항목을 비용으로 계상하고,
    author gate 를 1급 요구사항으로 넣는다.

---

## ~~맵 채팅 입력창이 "다른 사람이 근처에 있을 때만" 열린다~~ — 해결 (2026-08-22 · 2347315c)

- [x] **해결.** `inputEnabled = hasNearby`. 혼자 사무실에 있는 플레이어는 맵 채팅으로 NPC 를 부를 수 없다. `@[NPC]` 를 칠 입력창
  자체가 비활성이다. 2단계(자유채팅 NPC 동시 발언) 기능 전체가 이 게이트 뒤에 잠겨 있다.**
  - **Live evidence:** `feat/open-chat` 의 `e2e/open-chat.spec.ts` 를 살아 있는 게이트웨이
    (`127.0.0.1:8643` health 200)와 재시작된 dev 서버에 대고 실행 → 180초 타임아웃 1 failed.
    ```
    Error: locator.waitFor: Test timeout of 180000ms exceeded.
      - waiting for getByPlaceholder('메시지를 입력하세요...') to be visible
    ```
    패널은 열렸고("채팅" 헤더 보임) 입력창도 떠 있으나 disabled 였다.
  - **Root cause:** `src/game/scenes/GameScene.ts:2975`
    ```ts
    const inputEnabled = nearbyP.length > 0;   // nearbyP = remotePlayers(사람)만, NPC 제외
    ```
    바로 윗줄 `:2965` 의 `hasNearby = nearby.length > 0 || nearbyP.length > 0` 는 NPC 를
    포함하는데 입력 게이트만 사람으로 좁다. 최초 커밋 `1b97987e` 부터의 동작.
    `chat:send` 의 유일한 emit 경로는 `GamePageClient.tsx:1180` ← `onSendChannelChat` ←
    게이트된 `ChatInput` 하나 → **우회 경로 없음**.
  - **Blast radius:** 셀프호스팅 단일 사용자(가장 흔한 DeskRPG 사용 형태)에게 2단계 기능이
    전혀 보이지 않는다. 회의방은 영향 없다(별도 UI).
  - **Direction:**
    1. 게이트에 NPC 를 포함 — `inputEnabled = hasNearby` (윗줄에 이미 계산돼 있다).
       "말 걸 상대가 근처에 있으면 채팅창이 열린다"로 의미가 일관된다.
    2. 게이트를 유지하고 e2e 에 두 번째 플레이어를 등장시킨다 — 프로덕션 무변경이지만
       실사용자의 문제는 남는다.
  - **Acceptance:** 혼자 로그인한 세션에서 근처에 NPC 가 있을 때 맵 채팅 입력이 활성화되고,
    `e2e/open-chat.spec.ts` 가 셀렉터 변경 없이 통과한다.

- [x] **해결** (같은 커밋). 입력창이 잠겼을 때 "가까이 이동하세요" 대신 "응답 중..."이 뜬다 — 죽은 분기.**
  - **Root cause:** `ChatPanel.tsx:321` 이 `placeholder={disabled ? t("chat.moveCloser") : …}`
    를 넘기지만 `ChatInput.tsx:156` 은 `disabled ? resolvedDisabledPlaceholder : resolvedPlaceholder`
    이라 disabled 일 때 `placeholder` 를 **무시**하고 `disabledPlaceholder`(기본값
    `t("chat.responding")` = "응답 중...")를 쓴다. `chat.moveCloser` 분기는 도달 불가.
  - **Blast radius:** 사용자는 아무도 대답하고 있지 않은데 "응답 중..."을 보고 기다린다.
    잠긴 진짜 이유(가까이 가야 한다)를 알 방법이 없다.
  - **Direction:** `ChatPanel` 이 `disabledPlaceholder={t("chat.moveCloser")}` 로 넘긴다.
  - **Acceptance:** 근처에 아무도 없을 때 입력창 placeholder 가 "가까이 이동하세요..."다.

---

## ~~`deskrpg create-user` 가 비밀번호를 CLI 인자로만 받는다~~ — 해결 (2026-08-23)

- [x] **해결.** 프롬프트(에코 없음)와 `--password-stdin` 을 추가했다. 비밀번호를 `--password PW` 로만 넘길 수 있어서, 셸 히스토리와 `ps` 출력에 평문으로
  남는다. 대화형 입력 경로가 없다.**
  - **Live evidence:** `bin/deskrpg.js:583-584` 가 `--password` 다음 인자를 그대로 읽고
    (`result.password = args[++i]`), `:595` 이 없으면 usage 를 찍고 종료한다. 저장소 전체에
    prompt·readline·stdin 기반 대체 경로가 없다.
    ```
    $ deskrpg create-user --login-id alice --nickname Alice --password hunter2
    $ history | tail -1        # 평문으로 남는다
    $ ps aux | grep deskrpg    # 실행 중에는 다른 사용자에게도 보인다
    ```
  - **오탐과 구분:** 같은 조사에서 `bin/deskrpg.js:229` 의 `secret123` 이 시크릿 유출로
    보고됐으나 **오탐**이다. `printExamples()` 안의 도움말 문자열이고 저장소에 그 한 번만
    등장하며 기본값 폴백도 아니다. 진짜 문제는 노출된 값이 아니라 **입력 경로**다.
  - **Root cause:** `parseCreateUserArgs()`(`:575-590`)가 인자만 파싱한다. 저장 자체는
    안전하다 — `:632` 에서 `bcrypt.hash(password, 10)` 로 해싱해 넣는다.
  - **Blast radius:** 셀프호스팅 운영자가 관리자 계정을 만들 때마다. 공유 셸이나
    다중 사용자 서버에서는 `ps` 로 다른 사용자가 볼 수 있다. 문서(`CLAUDE.md` CLI Reference,
    스테이징 운영 절차)가 이 명령을 그대로 안내하고 있어 실제로 자주 실행된다.
  - **Direction:**
    1. `--password` 가 없으면 TTY 에서 **에코 없이** 프롬프트로 받는다(`readline` +
       `output.write` 억제, 또는 stdin raw mode). 있으면 지금처럼 동작시켜 스크립트·CI 호환을 깬다.
    2. `--password-stdin` 을 추가해 파이프 입력을 받는다(docker login 관례).
    3. 도움말 예시를 프롬프트 방식으로 바꾸고, `--password` 는 "비대화형 환경 전용,
       셸 히스토리에 남음" 경고와 함께 남긴다.
  - **Acceptance:** `--password` 없이 실행하면 프롬프트가 뜨고 입력이 화면에 찍히지 않는다.
    파이프로 넘긴 비밀번호로 계정이 만들어진다. `--password` 를 준 기존 호출은 그대로 동작한다.

---

## 외형 프리셋을 고르면 사용자가 쓴 페르소나가 조용히 사라진다 (2026-08-26 · test.deskrpg.com NPC 고용 live, `b4307a4e`)

- [ ] **`applyPresetSelection()` 이 `identityCustomized`/`soulCustomized` 를 읽지 않고 무조건 덮어쓴다. 같은 파일의 다른 두 경로는 그 플래그를 존중하므로, 가드가 있는데 이 경로만 빠진 일관성 결함이다.**
  - **Live evidence:** 스테이징에서 NPC 고용 모달을 열고 페르소나 textarea 에
    "단테랩스의 AI 어시스턴트. 간결하고 친근하게 한국어로 답한다." (35자) 를 먼저 입력한 뒤
    외형 **프리셋 "풀스택 개발자 B"** 를 클릭했다. 입력한 문장이 사라지고 페르소나 select 가
    `커스텀` → `Full-Stack Developer` 로 바뀌며 본문이 프리셋 IDENTITY.md(789자)로 교체됐다.
    경고·확인 없음. 되돌릴 UI 도 없다.
  - **Root cause:** `src/components/NpcHireModal.tsx:222-250`. `applyPresetSelection()` 은
    `setPersonaPresetId(preset.id)` 후 조건 없이 `setIdentity(...)`(`:239`)·`setSoul(...)`(`:245`)
    를 호출하고, 곧바로 `setIdentityCustomized(false)`·`setSoulCustomized(false)`(`:247-248`)
    로 "사용자가 손댔다"는 사실 자체를 지운다. 이 함수의 deps 에 두 플래그가 아예 없다(`:250`).
    같은 파일의 다른 두 경로는 정반대로 동작한다 —
    프리셋 로딩 effect 는 `if (personaPresetId === "custom" || identityCustomized || soulCustomized) return;`(`:351`)
    으로 빠져나가고, `handleNameChange()` 는 `if (!identityCustomized)`·`if (!soulCustomized)`(`:413`,`:418`)
    로 감싼다. 플래그는 textarea 편집 시 `:937`·`:1002`·`:1038` 에서 true 가 된다.
  - **Blast radius:** 커스텀 페르소나를 쓰고 나서 외형을 고르는 모든 사용자. 외형과 페르소나가
    한 모달의 위아래에 나란히 있고 UI 어디에도 "프리셋이 페르소나를 덮어쓴다"는 표시가 없어,
    자연스러운 순서(글 먼저 → 외형 나중)가 정확히 지뢰다. 편집 모드(`editingNpc`)에서
    프리셋을 눌러도 같으므로, **기존 NPC 의 다듬어둔 페르소나도 한 번의 클릭으로 날아간다.**
  - **Direction:**
    1. `applyPresetSelection()` 이 두 플래그를 존중하게 한다 — 커스텀 상태면 외형(`appearance`)
       만 적용하고 identity/soul 은 건드리지 않는다. 나머지 두 경로와 동작이 같아진다.
    2. 덮어써야 할 때는 명시적으로만 — "이 프리셋의 페르소나도 함께 적용" 확인을 받거나,
       페르소나 select 를 직접 바꿀 때만 본문을 교체한다.
    3. 외형 프리셋과 페르소나 프리셋이 지금 `personaPresetId` 하나로 묶여 있는 것(`:231`)이
       근본 원인이다. 분리 여부는 별도 판단.
  - **Acceptance:** 페르소나를 편집한 뒤 외형 프리셋을 눌러도 본문이 유지된다(외형만 바뀐다).
    편집하지 않은 상태에서는 지금처럼 프리셋 본문이 채워진다. 편집 모드에서 프리셋을 눌러도
    기존 NPC 의 페르소나가 남는다. 세 경우를 고정하는 컴포넌트 테스트가 있다.

---

## `chat_messages` 테이블이 죽어 있다 — 1:1 대화 이력이 서버 재시작으로 사라진다 (2026-08-26 · test.deskrpg.com live, `b4307a4e`)

- [ ] **스키마 4곳에 정의돼 있고 마이그레이션으로 실제 생성되지만, `src/db/` 밖에서 이 테이블을 읽거나 쓰는 코드가 하나도 없다. 실제 이력은 인메모리 Map 에만 있고 프로세스와 함께 사라진다.**
  - **Live evidence:** 스테이징에서 NPC "소피" 와 실제 대화를 성공시킨 직후(응답: "안녕하세요,
    저는 단테랩스 가상오피스에서 업무 정리와 운영, 분석 및 조사를 담당하는 소피입니다."),
    ```
    $ docker compose exec -T deskrpg-test-db psql -U deskrpg -d deskrpg \
        -c "select created_at, role, left(content,120) from chat_messages order by created_at;"
     created_at | role | content
    ------------+------+---------
    (0 rows)
    ```
    보낸 메시지도 받은 응답도 남지 않았다. 테이블은 존재하며 인덱스·FK 까지 정상이다.
  - **Root cause:** `rg -n "chatMessages" src/ --glob '!src/db/*' --glob '!*.test.*'` 가 **0건**
    이다. 정의만 있고(`src/db/schema.ts:451`, `schema-sqlite.ts:507`, `schema.pg.cjs:492`,
    `schema.sqlite.cjs:537`, `sqlite-base-schema.js:329`) 소비자가 없다. 유일한 언급은 삭제
    CASCADE 주석 두 줄(`src/app/api/channels/[id]/route.ts:346`,
    `src/app/api/characters/[id]/route.ts:143`)로, 존재하지 않는 저장을 전제하고 있다.
    실제 이력은 `src/server/socket-handlers.ts:224` 의
    `npcChatHistory = new Map<string, {role, content, timestamp}[]>()` 에 쌓이며,
    바로 위 `:215` 주석이 성격을 밝힌다 — "kept for session lifetime".
  - **Blast radius:** 서버 재시작·재배포마다 모든 NPC 1:1 대화 이력이 사라진다. 스테이징은
    `npm run deploy:test` 로 앱 컨테이너를 재시작하므로 배포할 때마다 전부 날아간다. 완전
    소실은 아니다 — Hermes 쪽 세션(제목 = NPC×사용자 키)에는 남는다. 다만 **DeskRPG 가 자기
    DB 에서 대화를 다시 읽을 방법이 없어**, 이력 조회·검색·회의 인용이 불가능하고 멀티 인스턴스
    확장도 막힌다. 채널 이력(`channelChatHistory`, `:215`)도 같은 성질이다.
  - **판단 필요 (등록 시점 미해소):** 이 테이블이 **아직 구현 안 된 기능의 선행 스키마**인지,
    쓰다가 끊긴 **잔재**인지 코드만으로는 알 수 없다. 어느 쪽이냐에 따라 방향이 갈린다.
  - **Direction:**
    1. 의도가 "이력 영속화"라면 — `socket-handlers.ts` 의 두 push 지점
       (`:1547-1548` 플레이어 발화, `:1584` NPC 응답)에서 DB 에도 쓰고, 채팅 패널이 열릴 때
       메모리가 비어 있으면 DB 에서 읽어 채운다. 인메모리 Map 은 캐시로 남긴다.
    2. 의도가 "이력은 Hermes 가 갖는다"라면 — 테이블과 4개 스키마 정의를 지우고, 오해를 부르는
       CASCADE 주석 두 줄도 함께 고친다. 마이그레이션으로 drop 한다.
    3. 어느 쪽이든 `channelChatHistory` 의 휘발성도 같은 결정에 포함시킨다.
  - **Acceptance:** (1)이면 — 대화 후 `chat_messages` 에 행이 남고, 앱 컨테이너를 재시작한 뒤
    채팅 패널을 열었을 때 이전 대화가 보인다. (2)이면 — 스키마·마이그레이션·주석에서 테이블이
    사라지고, 이력이 휘발성이라는 사실이 코드 주석과 문서에 명시된다. 어느 쪽이든 그 동작을
    고정하는 테스트가 있다.

---

## ~~소켓이 재연결됐지만 join 이 다시 성립하지 않은 동안의 NPC 대화가 사라진다~~ — 해결 (2026-08-26 · test.deskrpg.com live, `5ce72083`)

- [x] **해결.** 클라이언트가 자기 characterId 를 실어 보내고 서버가 소유를 검증한다(`5ce72083`).
  ~~소켓이 붙어 있고 화면도 멀쩡한데 서버의 `players` 에는 없는 구간이 있다. 그 동안 오간
  NPC 대화는 캐릭터를 알 수 없어 이력이 통째로 사라졌다 — 응답까지 정상이라 화면은 성공을
  보여주고 기록만 없는, 조용한 유실이다.~~
  - **정정 (2026-08-26):** 이 항목은 처음에 "맵 로딩이 끝나기 전"으로 적었으나 **실측 결과
    틀렸다.** 로딩 중(`플레이어 0명 접속`)에는 헤더의 NPC 드롭다운이 아직 열리지 않아
    대화를 시작할 수조차 없다(브라우저로 3회 재현 시도, 전송 자체가 발생하지 않았고 서버
    로그도 비어 있었다). 진짜 창은 **소켓 재연결 직후 `player:join` 이 다시 성립하지 않은
    상태** — 배포·네트워크 끊김 뒤 화면은 살아 있는데 서버 `players` 에는 없는 구간이다.
    처음 결함을 발견한 상황도 배포 직후 재연결이었다.
  - **Live evidence (수정 전):** 대화는 성공했는데
    ```
    select count(*) from chat_messages;  →  0
    deskrpg-test-app | [TaskManager] No characterId for socket 7z07OGbFsUNR8PdAAAAP
    ```
  - **Live evidence (수정 후):** 앱 컨테이너를 재시작해 서버 `players` 를 비운 뒤, 새로고침
    **없이** 같은 탭에서 대화했다. 같은 요청에서 두 가지가 동시에 관측된다 —
    ```
    deskrpg-test-app | [TaskManager] No characterId for socket Pt74nitqu6mqXbO2AAAB
    chat_messages: 4 rows   (재연결 직후 발화 / 그 응답이 정상 저장)
    ```
    `players` 에 없다는 기존 경고는 그대로인데 이력은 남았다 — 클라이언트가 실어 보낸
    characterId 가 소유 검증을 통과해 쓰인 것이다. `rejected character claim` 로그는 없다.
    앱 재시작 후 패널을 열면 4행이 모두 복원된다.
  - **Root cause:** 대화 패널은 게임 씬과 무관하게 헤더 NPC 목록에서 열리고, `npc:chat` 은
    `players.get(socket.id)` 가 없어도 `npcConfig._channelId` 폴백으로 진행한다
    (`src/server/socket-handlers.ts:1580`). 이력 저장은 캐릭터를 요구하므로
    (`chat_messages` 는 `(character_id, npc_id)` 소유) 소유자를 모르는 발화는 남길 곳이 없었다.
  - **해결 방식:** 클라이언트가 `npc:chat`/`npc:history`/`npc:reset-chat` 에 characterId 를
    싣는다(URL 로 이미 알고 있다). 서버는 그 값을 그대로 믿지 않는다 —
    `pickHistoryCharacterId()` 가 join 된 소켓의 값을 우선하고, 없을 때만 클라이언트의 주장을
    쓰되 `characterBelongsToUser()` 로 `characters.userId === user.userId` 를 확인한다.
    검증이 빠지면 남의 characterId 를 실어 그 사람 이력에 쓸 수 있다.
  - **검증:** 변이 3종으로 고정했다 — 클라 값이 서버를 이기게(2건), 검증 요구 표시 제거(1건),
    소유 검증 무력화(1건). 단위 테스트 755개 통과.

---

## 검색·조회 요청이 태스크 등록 확인으로 되받아쳐진다 (2026-08-28 · test.deskrpg.com live, `1a9ff3c6`)

- [ ] **모든 1:1 발화 앞에 "업무 지시 감지 시 반드시 확인부터" 리마인더가 붙는다. 그래서 즉답 가능한 조회 요청까지 "이 작업을 태스크로 등록할까요?"로 되받고, 사용자가 "태스크 말고"라고 덧붙여야 비로소 실행한다.**
  - **Live evidence:** 스테이징에서 소피에게 연속으로 물었다.
    ```
    "지금 웹에서 Hermes Agent 최신 버전을 찾아보고 한 줄로 알려주세요."
      → "이 작업을 태스크로 등록할까요?"
    "아니요, 태스크 말고 지금 바로 웹을 검색해서 답해주세요."
      → (web_search 실행) "공식 GitHub 릴리스 기준 … v0.20.6"

    "웹에서 DeskRPG npm 패키지 최신 버전을 검색해서 한 줄로 알려주세요."
      → "이 작업을 태스크로 등록할까요?"
    ```
    3회 연속 같은 패턴이었고, 매번 "태스크 말고"를 앞에 붙여야 실행됐다. 즉 한 번의
    조회에 왕복이 두 번 든다.
  - **Root cause:** `src/lib/task-prompt.js:126` 의 `withTaskReminder()` 가 **매 발화마다**
    리마인더를 prepend 한다. 그 본문(`buildTaskReminder`, `:100-114`)은
    `"업무 지시 감지 시 반드시: 1. 먼저 \"이 작업을 태스크로 등록할까요?\" 확인"` 으로 시작하고,
    헤더가 `[SYSTEM REMINDER - MANDATORY TASK PROTOCOL]` 이라 강제성이 매우 높다.
    반대 방향 지침은 마지막 한 줄
    (`taskPrompt.reminderIgnoreCasual`: "일반 대화/질문에는 태스크 블록을 생성하지 마세요.")
    뿐인데, 이 문장은 **블록 생성만** 금지할 뿐 "확인부터 하라"는 1번 항목을 되돌리지 않는다.
    호출부는 `src/server/socket-handlers.ts` 의 `withTaskReminder(enrichedMessage, locale)` 로,
    조회인지 지시인지 구분 없이 전부 통과한다.
  - **Blast radius:** "찾아봐 / 검색해줘 / 알려줘" 류의 즉답 요청 전부. 사용자는 원하는 답을
    얻기까지 최소 두 번 말해야 하고, NPC 는 도움을 주기보다 절차를 되묻는 인상을 준다.
    태스크 기능을 쓰지 않는 사용자에게도 매 대화에 붙는다.
  - **판단 필요 (등록 시점 미해소):** 어디서 갈라야 하는지가 제품 판단이다 —
    (a) 프롬프트에서 조회/지시 구분을 강화한다, (b) 되돌릴 수 있고 즉시 끝나는 작업은
    확인 없이 실행하도록 규칙을 뒤집는다(Buzz 의 AUTO/NOTIFY/HUMAN-BLOCK 3분류가 참고 사례다 —
    `wiki/syntheses/deskrpg-buzz-실제-에이전트-회의-설계.md`), (c) 리마인더를 매 발화가 아니라
    태스크 맥락에서만 주입한다.
  - **Acceptance:** "오늘 서울 날씨 검색해줘" 같은 즉답 요청이 한 번에 실행된다. 반면
    "이 기능 만들어줘" 같은 다회 작업은 여전히 확인을 거친다. 두 경우를 각각 고정하는
    테스트가 있다.

---

## 태스크 등록을 승인해도 아무 일이 없다 — 재연결 구간에서 조용히 실패 (2026-08-28 · test.deskrpg.com live, `1a9ff3c6`)

- [ ] **NPC 가 "이 작업을 태스크로 등록할까요?"를 묻고 사용자가 승인했는데, 태스크가 만들어지지 않고 NPC 응답조차 남지 않는다. 화면에는 오류도 안내도 없다.**
  - **Live evidence:** 스테이징에서 실제 업무를 위임했다.
    ```
    "DeskRPG README 의 영문판과 한국어판이 어긋나는 곳이 있는지 점검하는 일을 맡아주세요."
      → "이 작업을 태스크로 등록할까요?"
    "네, 등록해주세요."
      → (응답 없음. 상태 줄에 "명령을 실행하는 중…"이 떴다가 사라짐)
    ```
    결과:
    ```
    select count(*) from tasks;   →  0
    태스크 탭:  "소피에게 할당된 태스크가 없습니다"  /  헤더 배지: 태스크 0
    chat_messages 마지막 행 = 사용자의 "네, 등록해주세요." (NPC 응답 없음)
    로그: [TaskManager] No characterId for socket XK1raZk_551IQ9pqAAAG  ×3
    ```
  - **Root cause:** `src/server/socket-handlers.ts:1681`. 바로 윗줄(`:1678`)은 오늘 고친
    `historyCharacterId`(= `resolveHistoryCharacterId()` 결과)를 쓰는데, 태스크 분기만
    `if (player?.characterId)` 로 **`players` 맵을 직접** 본다. 같은 함수 안에서 두 줄이
    어긋나 있다. 재연결 직후처럼 소켓이 `players` 에 없으면 이력은 남지만 태스크는
    `else` 로 빠져 `console.warn` 만 찍고 끝난다.
  - **왜 응답까지 사라졌나:** 태스크 분기를 건너뛰면 그 뒤의 `npc:response-complete` 는
    실행되지만, 이 턴의 NPC 발화는 `parsed` 를 태스크 처리에 넘기는 경로에서만 확정되는
    구조라 화면·DB 양쪽에 남지 않았다. (이 부분은 코드로 한 번 더 확인이 필요하다 —
    근인은 characterId 누락이 확실하나, 응답 유실의 정확한 경로는 미확정이다.)
  - **Blast radius:** 배포·네트워크 끊김 뒤 재연결된 세션에서 위임하는 모든 태스크.
    사용자는 승인까지 마쳤으므로 등록됐다고 믿는다 — 조용한 유실이고, 태스크 보드가
    비어 있는 것을 나중에 발견한다.
  - **Direction:** `resolveHistoryCharacterId()` 를 태스크 분기에도 쓴다. 이미 소유 검증을
    포함하므로 그대로 재사용하면 되고, 두 줄이 같은 값을 보게 된다. 그럼에도 캐릭터를
    알 수 없으면 `console.warn` 대신 **사용자에게 보이는 안내**를 띄운다 — 승인했는데
    아무 일도 없는 것보다 "다시 접속해 달라"가 낫다.
  - **Acceptance:** 재연결 직후 세션에서 위임·승인하면 `tasks` 에 행이 생기고 태스크 탭에
    보인다. 캐릭터를 끝내 알 수 없는 경우에는 화면에 이유가 표시된다. 두 경우를 고정하는
    테스트가 있다.

---

## 응답이 비면 화면이 조용하다 — "봤다"도 "실패했다"도 없다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **NPC 가 응답을 만들지 못하면 아무 일도 일어나지 않는다. 사용자는 자기 말이 전달됐는지, 실패한 것인지, 아직 하는 중인지 구분할 수 없다.**
  - **Live evidence (DeskRPG):** codex 토큰이 무효화됐을 때 화면에 나온 것은 **빈 응답**이었다.
    Hermes 는 run 을 정상 완료(`run.completed`)로 끝내면서 `messages: []`, 토큰 0 을 돌려줬고,
    원인(`credential pool: marking default-codex DEAD`)은 서버 로그를 열어야 알 수 있었다.
  - **Root cause:** `src/server/socket-handlers.ts:1671` 의 `if (response) { … }` 에
    **else 분기가 없다.** 응답이 빈 문자열이면 `npc:response-complete` 조차 보내지 않고
    조용히 끝난다. 실패를 알리는 경로는 `emitNpcSystemResponse()` 가 있지만, 이 경우는
    HTTP 층에서 성공이라 그 경로를 타지 않는다.
  - **Live evidence (Buzz, 대조):** 같은 성격의 실패를 화면에 쓴다. 직접 확인한 전환 —
    ```
    🐝 Fizz: Working        (요청 직후, 창 하단 고정 자리)
    🐝 Fizz: Search failed  (실패 후, 같은 자리)
    ```
    게다가 사용자 메시지에 에이전트가 `👀` 리액션을 남겨 **수신 자체를 먼저 알린다.**
    "봤다 / 하는 중 / 실패했다" 가 세 겹으로 갈려 있다.
  - **DeskRPG 의 현재 상태:** 가운데 한 겹(`npc.activity.*`, 2026-08-28 추가)만 있다.
    리액션 개념은 코드에 없다(`rg -ci reaction src/` → 페르소나 프리셋 파일 1건뿐, 무관).
  - **Blast radius:** 인증 만료·모델 오류·도구 실패 등 "정상 완료했지만 내용이 빈" 모든 경우.
    사용자는 앱이 멈춘 줄 알고 다시 보내거나 새로고침한다.
  - **Direction:**
    1. `if (response)` 에 else 를 붙여 빈 응답을 **실패로 취급**한다 — 이유를 알 수 있으면
       그 이유를(빈 messages + 토큰 0 이면 인증 의심), 모르면 일반 문구를 띄운다.
    2. 활동 상태 줄을 실패 표시에도 재사용한다. 이미 자리가 있으므로 문구만 바꾸면 된다.
    3. 수신 확인("봤다")은 별도 판단이다 — 리액션 UI 를 새로 만들지, 상태 줄에
       "받았습니다" 를 잠깐 띄울지.
  - **Acceptance:** 인증이 끊긴 상태에서 말을 걸면 화면에 이유가 표시된다. 서버 로그를
    열지 않고도 무엇이 잘못됐는지 안다. 빈 응답이 조용히 지나가는 경로가 없다.

---

## 처음 들어온 사람은 말 걸 상대가 없다 — 첫 대화까지 4단계 (2026-08-28 · Buzz 대조 관찰)

- [ ] **가입 직후 상태에서 AI 와 대화하려면 게이트웨이 등록 → 프로필 추가 → 채널 연결 → NPC 고용의 네 단계를 사용자가 모두 끝내야 한다. 그 전까지 사무실은 비어 있다.**
  - **Live evidence:** 이번 세션에서 스테이징을 처음부터 밟았다. 채널은 있는데 NPC 0명,
    `/gateways` 에서 게이트웨이를 만들고 Hermes 프로필을 추가하고 채널 설정에서 연결한 뒤에야
    NPC 고용 모달의 프로필 드롭다운에 선택지가 생겼다. 중간에 프로필을 빠뜨리면
    `"No profiles registered yet. Add one on the gateway management page."` 로 막힌다.
  - **Root cause:** `src/lib/builtin-projects.ts:84` 의 `createStarterProjectForUser()` 는
    **맵 프로젝트만** 만든다(+ `ensureBuiltinTilesets`). 채널·NPC·게이트웨이·프로필은
    만들지 않는다. 가입 라우트(`src/app/api/auth/register/route.ts`)도 이 함수만 부른다.
  - **Live evidence (Buzz, 대조):** 설치 직후 첫 화면에 에이전트 3명(Fizz·Honey·Pollen)이
    이미 있고 Fizz 가 먼저 인사한다. 대화까지 남은 단계가 **0** 이다. 안내 문구도
    `"Mention @Fizz or another teammate whenever you want their help."` 로, 무엇을 하면
    되는지가 한 문장이다.
  - **역설:** 설치 자체는 DeskRPG 가 훨씬 싸다(compose 한 줄 vs Docker 6개 + Rust 전체 컴파일).
    **가벼운 쪽이 오히려 시작이 멀다.**
  - **판단 필요 (등록 시점 미해소):** 기본 NPC 를 어떻게 줄지가 제품 판단이다 —
    (a) 게이트웨이 없이도 말은 거는 "안내역" NPC(연결 방법을 알려주고, 연결되면 진짜 대화로
    전환), (b) 가입 시 데모 게이트웨이를 함께 프로비저닝, (c) 빈 사무실은 두되 첫 진입에
    4단계를 한 화면으로 안내하는 온보딩.
  - **Acceptance:** 가입 직후 채널에 들어가면 말을 걸 대상이 최소 하나 있고, 그와의 대화가
    다음에 무엇을 해야 하는지 알려준다. 4단계를 미리 알고 있어야만 시작할 수 있는 상태가 아니다.

---

## 연결이 끊긴 상태가 4초 뒤 화면에서 사라진다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **소켓이 끊기면 토스트가 뜨지만 4초 후 사라진다. 그 뒤로는 입력창이 비활성화돼 있다는 것 말고 이유를 알 방법이 없고, 안내는 "새로고침하세요"뿐이며 복구 버튼이 없다.**
  - **정정:** 처음에 "끊김이 콘솔에만 남는다"고 관찰했으나 **틀렸다.** 실제로는 세 경로 모두
    사용자에게 알린다 — `disconnect` → `game.socketDisconnected`("실시간 연결이 끊겼습니다: {reason}"),
    `connect_error` → `game.socketConnectFailed`("실시간 연결에 실패했습니다. 새로고침 후
    다시 시도하세요."), 그리고 `setSocketConnected(false)` 가 입력창을 비활성화한다
    (`GamePageClient.tsx:2683`, `:2702`).
  - **진짜 격차:** 그 알림이 **휘발성**이다. `showToastNotification()` 이
    `setTimeout(() => setToastMessage(null), 4000)`(`GamePageClient.tsx:496`) 으로 4초 뒤
    지운다. 자리를 비운 사이 끊겼다 돌아오면 사용자는 입력이 왜 막혔는지 모른다.
    입력창의 대체 문구는 `chat.disconnected`("연결 끊김") 한 마디뿐이다.
  - **Live evidence (Buzz, 대조):** 릴레이에 닿지 못하는 동안 좌하단에 **상시 배너**가 남는다.
    ```
    Can't reach the relay
    Click to connect        ← 접근성 트리에서도 button "Connect to relay" 로 확인
    ```
    사라지지 않고, 복구 액션이 한 클릭이다. 새로고침을 요구하지 않는다.
  - **Blast radius:** 배포·네트워크 흔들림처럼 끊김이 잦은 환경 전부. 이번 세션에서만
    `socket connect_error` 가 세 번 났다. 게다가 오늘 고친 태스크·이력 결함이 모두
    "재연결 직후" 구간에서 났으므로, **사용자가 그 구간에 있다는 것을 아는 것 자체가
    중요하다.**
  - **Direction:**
    1. 연결 상태를 휘발성 토스트가 아니라 **지속 표시**로 바꾼다 — 헤더 배지(`AI 연결`)
       옆이나 채팅 패널 상단에 "연결 끊김"을 끊긴 동안 계속 둔다.
    2. "새로고침하세요" 대신 **재연결 버튼**을 준다. socket.io 는 이미
       `reconnection: true, reconnectionAttempts: Infinity`(`:590-593`)로 자동 재시도 중이므로,
       버튼은 즉시 재시도를 트리거하고 진행 상태를 보여주면 된다.
  - **Acceptance:** 끊긴 동안에는 화면 어딘가에 그 사실이 계속 보인다. 4초 뒤에 사라지지
    않는다. 복구를 위해 새로고침이 필요하지 않다.

---

## 회의에서 여러 NPC 가 동시에 일하면 맵이 말풍선으로 덮인다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **활동 말풍선은 NPC 마다 따로 뜬다. 1:1 에서는 적절하지만, 회의처럼 여럿이 동시에 도는 상황에서는 맵 위가 말풍선으로 가려진다.**
  - **현재 구현:** 2026-08-28 에 넣은 `npc:activity-bubble` 은 NPC 별로 독립적이다
    (`GameScene.ts` 의 `activityBubbles: Set<string>`). 참가자가 늘수록 말풍선도 그만큼 는다.
  - **Live evidence (Buzz, 대조):** 두 에이전트를 한 번에 멘션했을 때 하단 상태가
    **`Honey +1`** 로 나왔다 — 아바타를 겹쳐 놓고 "지금 둘이 일하는 중"을 한 줄로 압축한다.
    수신 확인도 `👀 2` 로 **숫자**여서, 몇 명이 받았는지 즉시 보인다.
  - **왜 중요한가:** DeskRPG 회의는 순번제라 "지금 누구 차례"가 의미를 갖는다. 그렇더라도
    준비 중·대기 중인 참가자가 여럿이면 개별 말풍선은 정보보다 소음에 가깝다. 특히
    아무도 답하지 않을 때(과거 회의에서 전원 PASS 로 집계된 사례) **몇 명이 실제로
    응답 중인지**를 볼 방법이 지금은 없다.
  - **Direction:** 회의 화면에서는 개별 말풍선 대신 **집계 표시**를 쓴다 — 회의 사이드바나
    헤더에 "N명 응답 중" + 참가자 아바타. 1:1 은 지금처럼 개별 말풍선을 유지한다.
  - **Acceptance:** 참가자 3명 이상 회의에서 맵이 말풍선으로 가려지지 않고, 몇 명이
    응답 중인지 한눈에 보인다. 1:1 대화의 말풍선 동작은 그대로다.

---

## 대화가 한 줄로만 쌓인다 — 접을 구조가 없다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **모든 발화가 시간순 한 줄로 쌓인다. 스레드도, 읽은 지점 표시도, 여러 채널의 미확인을 모아 보는 곳도 없다.**
  - **Live evidence:** 오늘 스테이징에서 소피와 나눈 대화가 열 몇 줄 쌓이자 초반 메시지가
    스크롤 한참 위로 밀렸다. 태스크 확인 프롬프트와 그에 대한 승인, 검색 요청과 답변이
    모두 같은 평면에 섞인다.
  - **Live evidence (Buzz, 대조):** 같은 분량의 대화가 **세 줄**로 유지됐다.
    ```
    Fizz    …인사…                          1 reply · last reply 2 hours ago
    dante   @Fizz 검색해줘…                  1 reply · last reply 2 hours ago
    dante   @Honey @Pollen 자기소개…    🐞🤖 2 replies · last reply 28 minutes ago
    ```
    답글은 스레드로 접히고, 스레드 요약에 **답한 에이전트 아바타**가 붙어 열지 않고도
    누가 응답했는지 안다. 여기에 `NEW` 구분선(마지막으로 읽은 지점)과 Inbox(여러 채널의
    미확인을 `All ⌄` 필터로 모아 보기)가 더해진다.
  - **판단 필요 (등록 시점 미해소):** 셋 다 넣을지, 무엇부터일지가 제품 판단이다.
    DeskRPG 는 공간 은유가 중심이라 "채널을 옮겨 다니며 미확인을 처리한다"는 Inbox 모델이
    제품 성격과 맞는지 따로 봐야 한다. 반면 **스레드**는 태스크 확인/승인 같은 곁가지 대화를
    본문에서 걷어내므로 효과가 가장 직접적이다.
  - **Direction:** 스레드부터 검토한다 — 최소 형태는 "태스크 확인 프롬프트와 그 응답을
    본문이 아니라 접힌 블록으로" 다. 읽은 지점 표시는 이력 영속화(2026-08-28 완료) 위에
    올리면 되므로 비용이 작다.
  - **Acceptance:** 대화가 길어져도 본문에서 주요 흐름을 따라갈 수 있다. 곁가지 확인 대화가
    본문을 밀어내지 않는다.

---

## 돌고 있는 NPC 를 멈출 방법이 없다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **`stopRun()` 이 구현돼 있는데 아무도 부르지 않는다. 화면에도 중단 버튼이 없다. NPC 가 오래 돌거나 회의가 폭주해도 사용자는 기다리는 것 말고 할 수 있는 게 없다.**
  - **Root cause:** `src/lib/hermes/hermes-client.ts:274` 에 `async stopRun(runId)` 가 있고,
    실행 중인 run 을 추적하는 장치까지 갖춰져 있다 —
    `registerHermesRun(sessionKey, runId)`(`socket-handlers.ts:951`, `:1113`) /
    `clearHermesRun(sessionKey)`(`:967`). 즉 **어느 세션이 어느 run 을 돌리는지 이미 알고 있다.**
    그런데 `stopRun` 을 호출하는 코드가 저장소에 없고(`rg` 로 확인), ChatPanel·회의실 UI 에
    중단·취소 컨트롤도 없다.
  - **Live evidence (Buzz, 대조):** 에이전트 관리 화면 상단에 **`Stop running agents`** 가
    상시 놓여 있다. 개별 카드의 `⋮` 메뉴와 별개로, 전원 정지가 한 번에 닿는 자리에 있다.
  - **Blast radius:** 도구를 오래 무는 요청(웹 검색 여러 번, 긴 터미널 작업), 회의에서 참가자
    하나가 응답을 끌 때. 이번 세션에서도 30초 넘게 도는 응답을 여러 번 기다렸고, 그동안
    입력창은 비활성화된다. 폭주한 회의를 멈추는 수단이 전혀 없다.
  - **Direction:**
    1. 1:1 대화에 **중단 버튼** — 스트리밍 중에는 전송 버튼을 정지 버튼으로 바꾼다.
       (오늘 넣은 활동 상태 줄 옆이 자연스러운 자리다.)
    2. 회의에 **전원 정지** — 진행 중인 모든 run 을 끊는다. 이미 `sessionKey → runId` 맵이
       있으므로 순회하면 된다.
    3. 중단은 실패가 아니라 사용자 의도이므로, 화면에는 오류가 아니라
       "중단했습니다"로 표시한다.
  - **Acceptance:** 응답이 도는 중에 사용자가 멈출 수 있고, 멈춘 뒤 곧바로 다시 말을 걸 수 있다.
    회의에서도 전원 정지가 닿는다. 중단이 오류로 보이지 않는다.

---

## 승인 대기가 다른 알림과 같은 등급이다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **NPC 가 "이 작업을 태스크로 등록할까요?"라고 물어도, 사용자가 그 채널을 보고 있지 않으면 알 방법이 없다. 알림 개념 자체가 없다.**
  - **현재 상태:** 승인 프롬프트는 채팅 본문에 한 줄로 섞여 나온다. 자리를 비웠다 돌아오면
    스크롤 어딘가에 묻힌다. 오늘 실사용에서도 확인 프롬프트를 지나치기 쉬웠다.
  - **Live evidence (Buzz, 대조):** 알림 설정이 이벤트별로 갈리고 각각 알림음·미리듣기·on/off 를
    갖는다 — Direct messages / @Mentions / Thread replies / **Needs action**. 마지막 항목의
    설명이 정확히 이 상황이다:
    > When an approval or reminder is waiting on you.
    사이드바 배지도 `mentions and needs-action items` 를 함께 센다. 즉 **승인 대기를 일반
    메시지와 다른 등급으로** 취급한다.
  - **왜 DeskRPG 에 특히 중요한가:** DeskRPG 는 태스크 위임이 핵심 기능이고, 그 흐름이
    **반드시 승인을 거친다**(`task-prompt.js` 의 리마인더가 강제한다). 즉 승인 대기는 예외가
    아니라 정규 상태인데, 그것을 알리는 장치가 없다.
  - **Direction:**
    1. 승인 대기를 **별도 상태**로 모델링한다 — 채팅 본문의 한 줄이 아니라, 헤더 배지나
       태스크 탭에 "N건 대기"로 센다.
    2. NPC 가 걸어와서 알리는 기존 장치(`npc:movement-arrived`)를 승인 대기에도 쓴다 —
       공간 은유와 잘 맞는다.
    3. 브라우저 알림까지 갈지는 별도 판단.
  - **Acceptance:** 승인 대기가 있으면 다른 채널·화면에 있어도 알 수 있다. 대기 건수가
    어딘가에 세어져 있고, 클릭하면 그 대화로 간다.

---

## NPC 가 응답하지 않을 때 사용자가 할 수 있는 일이 없다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **게이트웨이가 죽거나 자격증명이 만료돼도 UI 상에는 "조용함" 만 있다. 재시작·상태확인·로그 열람이 전부 서버 셸에만 있다.**
  - **Live evidence (DeskRPG):** 이번 세션에서 sophie 프로필의 codex 토큰이 만료됐을 때
    화면에는 빈 응답만 나왔다. 원인 확인은 MiniPC 에서
    `journalctl --user -u hermes-gateway` 를 봐야 했고, 복구도 `codex login --device-auth`
    + `systemctl --user restart hermes-gateway` 였다. 사용자는 아무것도 할 수 없다.
  - **Root cause:** NPC 에 런타임 수명주기 개념이 없다. `src/db/schema.ts` 의 `npcs` 는
    `adapterType`/`adapterConfig`/`hermesProfileId` 만 갖고 실행 상태 컬럼이 없다.
    `src/server/socket-handlers.ts:1901` 의 `npc:stop-moving` 은 이동 정지일 뿐 실행 정지가
    아니다.
  - **Live evidence (Buzz, 대조):** 에이전트 프로필 패널의 **1급 버튼 3개**가
    `Stop` · `Restart agent` · `Message` 다. Runtime 탭에 `Status: Running`,
    `Start on launch` 토글, **`Harness log >`** 가 있다. 말을 걸기 전에 살아 있는지가
    먼저 보이고, 죽었으면 그 자리에서 되살린다.
  - **Blast radius:** 스테이징·셀프호스팅 사용자 전원. 게이트웨이 문제는 드물지 않고,
    발생하면 "DeskRPG 가 고장났다" 로 인식된다.
  - **Direction:**
    1. NPC 상세 패널에 **상태 뱃지**(연결됨/응답없음/미설정)를 붙인다. 판정이 아니라
       진단으로 — 이미 백로그의 "게이트웨이 검증을 판정에서 진단으로" 항목과 같은 방향.
    2. **재연결/재시도 버튼** 을 그 옆에 둔다. 게이트웨이 프로세스 재시작까지는 아니어도
       세션 재생성·토큰 재검증은 앱에서 가능하다.
    3. 최근 실패 사유(HTTP 상태, 어댑터 에러 메시지)를 접었다 펼 수 있게 노출한다.
       Buzz 의 `Harness log` 에 해당.
  - **Acceptance:** 게이트웨이를 일부러 죽인 상태에서 NPC 를 열면 "응답 없음" 과 이유가
    보이고, 게이트웨이를 되살린 뒤 버튼 한 번으로 정상으로 돌아온다. e2e 가 이 두 상태를
    고정한다.

---

## 회의실이 영구 채널과 같은 취급을 받는다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **`channels` 에 수명주기 개념이 없다. 한 번 쓰고 끝나는 회의실이 `general` 과 동일한 영구 공간으로 남는다.**
  - **Root cause:** `src/db/schema.ts` 의 `channels` 컬럼은
    `name / description / ownerId / groupId / mapData / mapConfig / isPublic / inviteCode /
    maxPlayers / password / gatewayConfig` 뿐이다. **타입도, 보관(archive)도, 만료도 없다.**
    회의 산출물은 `meeting_minutes` 로 남지만 회의실 자체를 접는 개념이 없다.
  - **Live evidence (Buzz, 대조):** 채널 생성 다이얼로그의 `Type` 이
    **`Ongoing` / `Temporary`** 두 가지다. 생성 시점에 `Template` 도 붙어 "무엇을 하는
    방인지"가 정해진다. 채널 설정에는 `Archive channel` 이 `Delete channel` 과 별도로 있다.
  - **왜 DeskRPG 에 맞는가:** DeskRPG 의 회의는 이미 **본질적으로 임시**다(주제를 정해
    NPC 를 모으고, 끝나면 회의록이 남는다). 그런데 그 방이 사이드바에 영구히 쌓인다.
  - **Direction:**
    1. `channels` 에 타입(또는 `archivedAt`)을 추가하고, 회의실은 종료 시 자동 보관.
    2. 보관된 채널은 사이드바에서 접히고 회의록으로 접근한다.
    3. 스키마 변경 시 **`src/db/sqlite-base-schema.js` 와 `ensureSqliteCompatibility()` 를
       같은 변경 안에서 갱신**한다(CLAUDE.md 규칙).
  - **Acceptance:** 회의를 끝내면 그 채널이 목록에서 접히고, 회의록에서 되짚어 열 수 있다.
    빈 SQLite 로 `deskrpg init/start` 와 Docker SQLite 기동이 모두 통과한다.

---

## NPC 지시 권한이 채널 멤버십 하나뿐이다 (2026-08-28 · Buzz 대조 관찰)

- [ ] **채널에 들어온 사람은 누구나 그 채널의 모든 NPC 에게 태스크를 시킬 수 있다. NPC 별 권한이 없다.**
  - **Root cause:** 권한 판정이 채널 단위다 —
    `src/server/socket-handlers.ts:1362` 의 `isChannelMember: channel.ownerId === userId ||
    channelMembershipRows.length > 0`. `npcs` 테이블에는 소유자·허용자 컬럼이 없다.
  - **Live evidence (Buzz, 대조):** 에이전트 Runtime 탭에
    **`Who can send instructions: Selected people`** 항목이 있다. 에이전트마다 지시 권한을
    나눈다.
  - **Blast radius:** 지금은 스테이징이 단일 사용자에 가깝지만, `deskrpg create-user` 로
    사용자를 늘리는 순간 문제가 된다. NPC 가 게이트웨이 자격증명(= 단테의 codex 계정)을
    쓰므로 **권한 문제이자 비용 문제**다.
  - **Direction:**
    1. NPC 에 최소한 `ownerUserId` 를 둔다(이미 `gateway_resources.ownerUserId` 선례가 있다).
    2. 지시 가능 범위를 `owner / channel-members / selected` 셋 중 하나로.
    3. 태스크 위임 경로(`targetUserId` 를 이미 쓰는 곳)와 함께 검사한다.
  - **Acceptance:** 권한 없는 사용자가 NPC 에게 태스크를 시키면 명시적으로 거절되고,
    거절 사유가 화면에 뜬다(조용히 무시되지 않는다). 단위 테스트가 세 모드를 고정한다.

---

## 수신·처리 신호를 위한 장치가 없다 — 리액션이라는 값싼 해법 (2026-08-28 · Buzz 대조 관찰)

- [ ] **NPC 가 메시지를 받았는지, 처리 중인지, 답을 마쳤는지를 대화 밖에서 알 방법이 없다. 회의에서는 더 심하다.**
  - **현재 상태:** 리액션 개념이 코드베이스에 없다(`rg -i reaction src/` → 실질 0건).
    활동 표시(`npc:activity`)를 이번 세션에 넣었지만 **1:1 채팅의 진행 중 상태**만 다룬다.
  - **Live evidence (Buzz, 대조):** 메시지에 `👀 2` / `💬 2` 가 붙는다. 확인해 보니
    **전용 UI 가 아니라 에이전트가 스스로 단 일반 이모지 리액션**이다(스레드 답글 수는
    그 아래 `2 replies` 로 따로 나온다). 즉 Buzz 는 "받았음/답했음" 신호를 위해 새
    컴포넌트를 만들지 않고 **이미 있는 리액션 기능을 에이전트에게 쓰게 했다.**
    hover 툴바에는 자주 쓰는 3종(`:+1: :heart: :joy:`)을 피커 밖으로 꺼내 두었다.
  - **왜 값어치가 큰가:** 과거 "전원 PASS" 사고 — 회의에서 모든 NPC 가 조용히 넘어가도
    화면상 구분이 안 됐다 — 의 UI 판 해법이다. 몇 명이 받았는지가 숫자로 보이면
    "아무도 안 받았다" 와 "받고 패스했다" 가 구분된다.
  - **Direction:**
    1. 메시지 리액션을 일반 기능으로 먼저 만든다(사람도 쓴다). 저장은 메시지 단위.
    2. NPC 파이프라인이 수신 시 👀, 응답 완료 시 💬 를 자동으로 단다.
    3. 회의 라운드에서 PASS 한 NPC 도 리액션은 남긴다 — 침묵과 부재를 구분한다.
  - **Acceptance:** 회의에서 전원이 PASS 해도 참가자 수만큼 수신 리액션이 남아, 사용자가
    "전달은 됐다" 를 화면에서 확인할 수 있다.

---

## ~~사용자가 쓴 페르소나가 Hermes 로 전송되지 않는다~~ (2026-08-29 발견 · **2026-08-30 해결** `a0d2c2d8`)

> **해결 요약.** 전송 경로를 이었고(`getNpcConfig` → `npcInstructions()` → 어댑터 두 경로),
> 규약을 이름표 층으로 갈랐다. **인격은 보내지 않기로 확정** — SOUL.md 가 단일 소유자다.
> 대신 편집 칸을 "게이트웨이에서 관리됩니다" 안내로 바꿔 화면의 거짓말을 끝냈다
> (`PersonaSection` 의 `isExistingAgentSelected` 가 `false` 로 하드코딩돼 안내가 한 번도
> 보이지 않고 있었다). 인격을 DeskRPG 에서 쓰는 길은 `deskrpg-hermes-plugin` 이 연다.
> 죽은 `buildGatewayAgentFiles()` 제거. 786개 테스트 통과, 뮤테이션 6종 검증.

- [x] **NPC 고용 화면의 `identity`/`soul` 입력이 DB 에 저장만 되고 에이전트에게 전달되지 않는다. 사용자는 성격을 쓰고 저장까지 확인하지만 NPC 는 그걸 읽은 적이 없다.**
  - **Live evidence:** 화면 → DB 는 이어지는데 DB → Hermes 가 끊겨 있다.
    - `src/app/api/npcs/route.ts:164-222` — `personaConfig`(identity/soul)를 `agentConfig` 에 저장 ✓
    - `src/server/socket-handlers.ts:715-742` — `getNpcConfig()` 가 `agentConfig` 에서
      `agentId`·`sessionKeyPrefix`·`passPolicy` 만 꺼낸다. **`personaConfig` 를 읽지 않는다.**
    - `src/lib/hermes/hermes-client.ts:246,251` — `instructions` 필드가 **정의돼 있는데
      호출하는 곳이 0건**(전체 검색). 보낼 통로를 만들어 두고 쓰지 않았다.
  - **Root cause:** OpenClaw 시절에는 페르소나를 게이트웨이의 에이전트 파일
    (`IDENTITY.md`/`SOUL.md`)로 프로비저닝했고, Hermes 로 옮기면서 그 경로가 사라졌는데
    대체 경로를 잇지 않았다. 잔재가 `src/lib/npc-agent-defaults.ts:269`
    `buildGatewayAgentFiles()` — **호출자 0개**.
  - **Blast radius:** 모든 NPC. 지금 NPC 의 인격은 전적으로 Hermes 프로필의 `SOUL.md` 가
    결정한다. "성격을 바꿨는데 왜 똑같지?" 가 발생하고 원인이 화면 어디에도 없다.
    이 세션의 **"성공을 보고하는 실패"** 계열 중 사용자 체감이 가장 큰 건이다.
  - **SOUL.md 의 실제 상태 (2026-08-29 재실측 · 앞선 기술 정정):** 처음에 "sophie 는
    SOUL.md 가 없다"고 적었으나 **틀렸다** — `ls | head -20` 에 잘린 것이었다.
    sophie·mia·noah·sam **네 프로필 모두 SOUL.md 가 있고 내용도 채워져 있다**
    (886/858/878/923 bytes, 각각 다른 한국어 역할 정의). `default` 프로필만 없다.
    Hermes 는 프로필 생성 시 `DEFAULT_SOUL_MD` 를 심는다(`hermes_cli/profiles.py:1269`)
    — 즉 **SOUL.md 는 항상 존재하고, 쟁점은 "있느냐" 가 아니라 "손댔느냐" 다.**
  - **Live evidence (Buzz, 대조):** Buzz 는 세션 생성 시 시스템 프롬프트를 조립해 보낸다
    (`crates/buzz-acp/src/pool.rs:1092`). 하네스 능력에 따라 전달 경로가 갈린다 —
    ACP protocol-v2 는 `session/new`, Goose 는 전용 요청, 레거시는 사용자 메시지 섹션.
  - **Direction:**
    1. `getNpcConfig()` 가 `personaConfig` 를 읽는다.
    2. Hermes 호출에 `instructions` 를 실어 보낸다. 세 경로 모두 받는다(실측, v0.20.6):
       `/v1/runs` 는 `instructions`, `/api/sessions/{id}/chat[/stream]` 은
       `system_message` 또는 `instructions`.
    3. `buildGatewayAgentFiles()` 와 관련 죽은 코드를 같은 변경에서 제거한다.
    4. 프로필에 이미 `SOUL.md` 가 있는 경우 덮어쓸지 여부는 아래 "프롬프트 층" 항목의
       모드 선택으로 넘긴다 — 이 항목은 **전송 경로를 잇는 것까지**다.
  - **Acceptance:** NPC 편집 화면에서 성격을 바꾸면 다음 대화부터 반영된다.
    단위 테스트가 "personaConfig 가 있으면 instructions 에 실린다"와
    "없으면 필드를 아예 보내지 않는다"를 고정한다.

---

## 프롬프트 구성 요소가 인격에 뒤섞여 들어간다 (2026-08-29 · **일부 해결** `a0d2c2d8`)

> **해결된 부분.** `composeNpcInstructions()` 가 `<team-instructions>` / `<task-protocol>`
> 두 층을 이름표 경계로 조립해 보낸다. 인격은 SOUL.md 단일 소유로 확정.
> **2026-08-31 추가 해결** `09ea866f` — `injectTaskPrompt()` 주입을 걷어내고 함수 자체를
> 제거했다. 저장되는 인격에는 사용자가 쓴 것만 남는다.
> **남은 부분:** `<channel-context>` 층이 아직 없다. 그리고 `localizeNpcPromptDocument`
> 이 인격 앞에 "## 언어 정책" 블록을 붙인다 — 같은 계열의 주입이지만 문서 지역화에
> 가까워 남겨 두었다. 판단 필요.

- [ ] **회의 규칙·태스크 승인 프롬프트·언어 설정이 사용자의 인격 텍스트 안으로 주입된다. 남의 프로필(mia/noah)을 빌려 쓸 때 안전하게 얹을 방법이 없다.**
  - **Root cause:** `injectTaskPrompt(identity, locale)` 가 태스크 프롬프트를 **인격 문자열
    자체에 섞는다** — `src/app/api/npcs/route.ts:174,209`, `src/app/api/npcs/[id]/route.ts:122`,
    `src/lib/npc-agent-defaults.ts:261`. 회의 규칙은 또 별도로
    `agentConfig.meetingProtocol` 에 따로 산다(`route.ts:221`). 즉 **한 덩어리에 섞인 것과
    따로 떨어진 것이 공존**하고, 어느 쪽도 경계가 없다.
  - **Blast radius:** (a) 사용자가 인격을 편집하면 태스크 프롬프트를 같이 지울 수 있다.
    (b) 이미 인격이 있는 프로필에 "회의 규칙만" 얹는 것이 불가능하다 — 단테가 요청한
    "추가 설정이 필요한 부분만 선택적으로"가 여기서 막힌다.
  - **Live evidence (Buzz, 대조):** `crates/buzz-acp/src/pool.rs:1092` 가 층을 **이름표 붙은
    경계**로 감싸 조립한다 — `framed_system_prompt` → `with_team`(`<team-instructions>`)
    → `with_core`(`<core-memory>`) → `with_huddle_instructions` → `with_canvas`
    (`<channel-canvas>`). 각 층은 `prompt_framing::semantic_section(name, body)` 로
    감싸이고 서로 침범하지 않는다. 데스크톱 트랜스크립트 뷰어는 그 경계를 읽어
    섹션별로 되짚는다(`agentSessionTranscriptHelpers.ts:23`).
  - **Direction:**
    1. `composeNpcPrompt()` 하나를 만들어 층을 조립한다 —
       `<identity>` · `<team-instructions>`(회의 규칙) · `<task-protocol>`(승인 절차) ·
       `<channel-context>`. 각 층은 독립적으로 켜고 끌 수 있다.
    2. `injectTaskPrompt` 의 문자열 주입을 걷어내고 층으로 옮긴다.
    3. **인격은 SOUL.md 가 단일 소유자다.** DeskRPG 는 인격을 `instructions` 로 보내지
       않는다 — 아래 제약대로 덧붙기밖에 안 되고, 두 인격이 공존하면 결과가 불안정하다.
       DeskRPG 가 보내는 것은 **행동 규약 층만**이다(회의 규칙·태스크 절차·채널 맥락·언어).
       인격을 DeskRPG 에서 만들고 고치는 것은 **플러그인이 SOUL.md 를 직접 쓰는 경로**로
       해결한다(아래 `deskrpg-hermes-plugin` 항목). 2026-08-29 결정.
  - **하드 제약 — `instructions` 는 SOUL.md 를 대체하지 않고 뒤에 이어 붙는다 (실측):**
    `agent/conversation_loop.py:1568` 과 `:2391` 이 동일하게
    `effective = (effective + "\n\n" + agent.ephemeral_system_prompt).strip()` 이다.
    SOUL.md 는 `active_system_prompt` 안에 있고 우리가 보내는 것은 그 **뒤**에 붙는다.
    `agent/system_prompt.py:778` 주석도 *"ephemeral_system_prompt 는 여기 포함되지 않는다 —
    캐시/저장되는 시스템 프롬프트 밖에 두려고 API 호출 시점에만 주입한다"* 고 명시한다.
    **따라서 HTTP 로는 프로필 인격을 끌 수 없다.** 진짜 덮어쓰기는 파일을 고치는 것이고
    그건 로컬에서만 가능하다. 화면 문구가 "덮어쓰기" 라고 말하면 거짓말이 된다.
    4. 조립 결과를 그대로 보내지 말고 **어느 층이 실렸는지 기록**한다 — 진단에 쓴다.
  - **Acceptance:** mia 프로필(SOUL.md 보유)에 회의 규칙만 얹어 NPC 를 만들면, 그
    NPC 가 mia 의 인격을 유지한 채 회의 규칙을 따른다. 단위 테스트가 세 모드 각각에서
    어떤 층이 실리고 빠지는지를 고정한다.

---

## 설정이 어디서 왔는지 추적하지 않아, 마법사를 만들 수 없다 (2026-08-29 · Buzz 대조)

- [ ] **NPC 설정 값이 사용자가 쓴 것인지·프리셋 기본값인지·Hermes 프로필이 이미 갖고 있는 것인지 구분되지 않는다. 그래서 "이미 설정된 것은 묻지 않는" 마법사를 만들 수 없다.**
  - **현재 상태:** `resolvedIdentity = identity?.trim() || persona?.trim() ||
    presetDefaults?.identity || ""` (`src/app/api/npcs/route.ts:160`) — **`||` 폴백 사슬**로
    값을 고르고 **어디서 왔는지는 버린다.** 화면은 최종 값만 보여준다.
  - **Blast radius:** 신규 사용자 온보딩 전체. 지금 프로필을 추가하려면 서버 셸에서
    `API_SERVER_KEY` 를 만들어 붙여넣어야 하는데(실측), 화면은 그 사실을 안내하지 않는다.
  - **Live evidence (Buzz, 대조):** `desktop/src-tauri/src/managed_agents/config_bridge/types.rs`
    의 `ConfigOrigin` 이 값마다 출처를 7단계로 기록한다 — `BuzzExplicit` /
    `AcpNativeRead` / `AcpConfigOption` / `EnvVar` / `ConfigFile` / `PersonaDefault` /
    `GlobalDefault`. 주석: *"어느 설정 값이 어디서 왔는지 — 우선순위와 UI 표시를 결정한다."*
    나아가 **하네스에게 ACP 로 직접 물어보고**, 하네스 자기 설정파일까지 읽어
    *"파일 층에 이미 만족된 요구사항을 침묵시킨다"*(`config_bridge/mod.rs`).
  - **Direction:**
    1. NPC 설정 해석을 `||` 사슬에서 **`{ value, origin }` 을 돌려주는 리졸버**로 바꾼다.
       출처는 `deskrpg-explicit` / `hermes-profile` / `preset-default` / `builtin-default`.
    2. `GET /p/<name>/v1/capabilities` 로 **프로필이 이미 무엇을 갖고 있는지 물어본다**
       (아래 capabilities 항목과 같은 조각).
    3. 편집 화면의 각 필드에 출처 배지를 붙인다.
    4. 그 위에 마법사를 올린다 — ① 게이트웨이(로컬 자동탐색 / 원격 주소) ② 프로필 연결
       ③ 인격 모드 3택 ④ 외모·자리 ⑤ **실제로 한 번 말을 걸어 확인.**
  - **원격의 한계 (실측 · Hermes v0.20.6 · 2026-08-30 갱신):** *기본* 라우트에는 프로필
    생성·목록 조회·설정 쓰기·키 발급이 **없다**(라우트 전수 확인,
    `capabilities.admin_config_rw` 는 `api_server.py:3361` 에 하드코딩된 `false`).
    **다만 플러그인이 API Server 에 라우트를 추가할 수 있다** — `api_server.py:8437`
    `_wire_plugin_handlers(self._app)`. 아래 `deskrpg-hermes-plugin` 항목이 이 경로를 쓴다.
    로컬은 `src/app/api/gateways/[id]/local-discovery/route.ts` 가 이미 프로필 목록과
    토큰을 파일에서 읽어 자동 등록한다 — **플러그인을 깔아도 최초 토큰 발급만은 셸에 남는다**
    (닭-달걀: 인증하려면 이미 키가 있어야 한다).
  - **Acceptance:** 마법사만으로 원격 게이트웨이의 기존 프로필에 NPC 를 붙여 대화까지
    성공한다. 토큰 붙여넣기 외에는 터미널을 열지 않는다. 마지막 단계가 실제 호출로
    성공을 확인하고, 실패하면 이유를 화면에 쓴다.

---

## `/v1/capabilities` 를 살아 있는지 확인하는 핑으로만 쓴다 (2026-08-29 · **2026-08-31 방향 수정**)

> **⚠️ 이 항목의 전제가 틀렸다.** 아래에 "초과분은 조용히 실패한다" 고 적었는데 **틀렸다** —
> Hermes 는 `429 + Retry-After: 1 + code: rate_limit_exceeded` 로 또박또박 거절한다
> (`api_server.py:7154-7182`). 조용히 버린 것은 DeskRPG 쪽이었다.
> `381d8756` 이 그 근본을 고쳤다 — 클라이언트가 429 를 재시도하고, 재시도 후에도 실패한
> 참가자를 `PollReport.failures` 로 기록해 침묵과 구분한다.
> **남은 것은 부하 예방뿐이다:** `maxConcurrentPolls` 가 `channel-runtime.ts:171` 에
> `?? 4` 로 하드코딩돼 있다. capabilities 의 `max_concurrent_runs` 를 읽어 맞추면
> 429 를 애초에 덜 만든다 — 다만 같은 게이트웨이를 쓰는 다른 클라이언트가 있으면
> 여전히 나므로, 재시도가 본체이고 이건 보조다. 스키마 변경(프로필별 capabilities 저장)이
> 필요해 별도 판단.

- [ ] **기능 맵을 받아 오지만 아무 판단에도 쓰지 않는다. 그것을 읽으라고 만든 헬퍼 두 개가 호출자 0건이다.**
  - **정정:** 어제 "DeskRPG 가 capabilities 를 읽지 않는다"고 적었는데 **틀렸다.**
    `getCapabilities()` 는 두 곳에서 호출된다. 다만 **둘 다 살아 있는지만 본다** —
    `src/lib/hermes-profiles.ts:250` 은 결과를 받아 `lastValidationStatus: "valid"` 만
    기록하고, `src/lib/adapters/hermes-adapter.ts:122` `testConnection()` 은 결과를 통째로
    버린다.
  - **Root cause:** `src/lib/hermes/types.ts:40-49` 에 fail-closed 계약까지 갖춘
    `readCapability()` 와 `readMaxConcurrentRuns()` 가 있는데 **호출자가 0건**이다.
    읽을 도구를 만들어 두고 쓰지 않았다.
  - **Blast radius (실측 근거 있음):** `max_concurrent_runs` 를 무시하는 것이 특히 위험하다.
    Hermes 는 이 값으로 에이전트 구동 엔드포인트 전체에 공유 상한을 걸고, **초과분은
    조용히 실패한다.** DeskRPG 의 회의는 N 명에게 동시에 요청을 쏘는 구조라 정면으로
    걸린다 — 과거 "전원 PASS" 사고와 같은 모양의 실패를 다시 만들 수 있다.
    현재 게이트웨이 설정은 `max_concurrent_runs: 10` 인데 DeskRPG 기본값은 4 로 하드코딩
    돼 있고, 어느 쪽도 실제 값을 읽지 않는다.
  - **Direction:**
    1. 프로필 검증 시 받은 capabilities 를 **저장한다**(`hermes_profiles` 에 컬럼 추가).
    2. 회의 팬아웃이 `readMaxConcurrentRuns()` 로 청크를 나눈다.
    3. `run_stop`·`run_steer` 가 없는 게이트웨이에서는 해당 UI 를 끈다 — fail-closed.
    4. 스키마 변경이므로 `src/db/sqlite-base-schema.js` 와 `ensureSqliteCompatibility()`
       를 같은 변경에서 갱신한다(CLAUDE.md 규칙).
  - **Acceptance:** `max_concurrent_runs` 를 2 로 낮춘 게이트웨이에서 NPC 4 명 회의를
    돌려도 조용히 빠지는 참가자가 없다. 단위 테스트가 청크 분할을 고정한다.

---

## `deskrpg-hermes-plugin` — 원격 게이트웨이를 화면에서 설정할 수 있게 (2026-08-30 · 방향 확정)

- [ ] **Hermes 플러그인으로 API Server 에 DeskRPG 전용 라우트를 붙여, 프로필 목록·생성과 SOUL.md 읽기·쓰기를 HTTP 로 연다. 이게 열리면 "로컬만 되고 원격은 안 되는" 갈림길이 사라진다.**
  - **확장점 (실측 · Hermes v0.20.6):** `gateway/platforms/api_server.py:8437`
    ```python
    # Plugin-registered native handlers (aiohttp web.Application —
    # router routes). Wired before AppRunner.setup() freezes the router.
    self._wire_plugin_handlers(self._app)
    ```
    계약은 `gateway/platforms/base.py:3706` — 플러그인이 register() 시점에
    `ctx.register_platform_handler("api_server", factory)` 를 부르면, 어댑터가 connect()
    에서 `factory(native, adapter)` 로 호출한다. `native` 는 **라우터가 얼기 전의 aiohttp
    `web.Application`**. 각 팩토리는 격리돼 있어 플러그인이 예외를 던져도 플랫폼 기동을
    막지 못한다.
  - **앞선 결론의 정정:** 2026-08-29 에 "Hermes API 에 프로필 CRUD 가 없으므로 원격 앱은
    바인딩만 가능"이라고 적었다. **기본 라우트만 본 것이었고 확장점을 놓쳤다.**
    위키 `hermes-api-server-프로필-스코프-http-제어-표면` 도 같은 오해를 담고 있어 함께
    고쳤다.
  - **왜 새로 구현하는 게 아닌가:** 프로필 CRUD 로직은 Hermes 안에 이미 있다 —
    `hermes-bot-mode` 가 데스크톱 게이트웨이의 `profiles.*` RPC(`list`/`create`/
    `describe`/`configure`)를 그대로 쓴다. 우리 플러그인은 **전송층 다리**를 놓는 것이지
    저장소나 로직을 새로 만드는 게 아니다. bot-mode 의 원칙을 그대로 따른다 —
    *"no core patches, no background daemons, no extra storage: everything is standard
    Hermes surface."*
  - **최소 라우트 (초안):**
    | 메서드 | 경로 | 하는 일 |
    |---|---|---|
    | GET | `/p/<profile>/deskrpg/identity` | SOUL.md 본문 + **손대지 않은 기본 템플릿인지** |
    | PUT | `/p/<profile>/deskrpg/identity` | SOUL.md 쓰기 |
    | GET | `/deskrpg/profiles` | 프로필 목록(이름·설명·인격 유무) |
    | POST | `/deskrpg/profiles` | 프로필 생성 |
    "손댔느냐" 판정은 Hermes 자신의 `hermes_cli/default_soul.py:is_legacy_template_soul()`
    을 그대로 호출한다 — 판정 규칙을 DeskRPG 가 흉내 내지 않는다.
  - **Blast radius / 위험 — 인증이 미들웨어가 아니다:** 앱 미들웨어는 프로필 프리픽스·
    CORS·바디 제한·보안 헤더 넷뿐이고(`api_server.py:8372-8382`), 인증은 **핸들러마다
    개별 호출**된다(`:1453` 주석 — *"every handler runs `_check_auth`"*).
    플러그인 핸들러가 `_check_auth()` 를 빼먹으면 **무인증 프로필 CRUD 엔드포인트**가
    열린다. 이 프로젝트의 가장 큰 위험이고, 스펙에서 가장 먼저 못박아야 한다.
    반대로 프로필 프리픽스 미들웨어는 앱 전체에 걸리므로 `/p/<name>/` 스코프는 공짜로 얻는다.
  - **Direction:**
    1. 별도 레포 `~/workspace/dante-code/projects/deskrpg-hermes-plugin`.
    2. 모든 핸들러가 `_check_auth()` 를 먼저 부른다. 이걸 강제하는 데코레이터/래퍼를
       하나 만들고, **빠뜨린 핸들러가 있으면 테스트가 실패**하게 한다.
    3. DeskRPG 는 이 라우트가 **있으면 쓰고 없으면 지금처럼** 동작한다 — 플러그인 미설치
       게이트웨이가 계속 존재한다. bot-mode 의 feature-detect + graceful degrade 패턴.
    4. 업스트림 내부 함수(`profiles.*` 등)에 의존하는 지점은 버전 가드로 감싼다.
  - **여전히 못 하는 것:** 최초 `API_SERVER_KEY` 발급. 인증하려면 이미 키가 있어야 하므로
    원리적으로 불가능하다. 원격에서 셸이 남는 유일한 지점.
  - **Acceptance:** 플러그인을 깐 원격 게이트웨이에 대해, DeskRPG 마법사만으로 프로필을
    만들고 인격을 쓰고 NPC 를 고용해 대화까지 성공한다. 토큰 붙여넣기 외에 터미널을 열지
    않는다. 플러그인이 없는 게이트웨이에서는 마법사가 "이 게이트웨이는 프로필 관리를
    지원하지 않습니다" 를 표시하고 기존 경로로 진행한다.
    무인증 요청이 모든 신규 라우트에서 401 을 받는 것을 테스트가 고정한다.

---

## CLI 어댑터가 시스템 지시를 조용히 버린다 (2026-08-31 · 배선 중 발견)

- [ ] **`AdapterExecuteOptions.instructions` 를 hermes 어댑터만 읽는다. claude·codex·gemini·opencode 어댑터는 받고도 쓰지 않는다 — 회의 규칙도 태스크 절차도 그 NPC 에게 닿지 않는다.**
  - **Root cause:** `src/lib/adapters/cli-base-adapter.ts` 의 실행부가 쓰는 것은
    `prompt`(stdin)·`cwd`·`env`·`timeoutMs` 뿐이다. `instructions` 를 읽는 곳은
    `hermes-adapter.ts:82,102` 두 줄이 전부다(전체 검색).
  - **Blast radius:** CLI 어댑터로 만든 NPC 전부. 이들에게는 Hermes 프로필의 SOUL.md
    같은 대체 인격 소스도 없어서, **인격도 규약도 없는 상태**로 돈다.
    `withTaskReminder()` 가 사용자 메시지 앞에 붙는 태스크 리마인더만 유일하게 닿는다.
  - **왜 지금 드러났나:** 인격/규약 전송 경로를 잇는 작업(`a0d2c2d8`)에서 필드를
    추가하며 발견했다. 그 전에는 아무도 아무것도 안 보냈으므로 차이가 없었다.
  - **Direction:**
    1. CLI 어댑터마다 시스템 프롬프트 전달 수단을 확인한다 — claude/codex CLI 는
       각자 시스템 프롬프트 플래그나 설정 파일 관례가 다르다. 없으면 프롬프트 앞에
       층을 붙이는 폴백(레거시 ACP 경로에 대한 Buzz 의 처리와 같은 방식).
    2. **어느 어댑터가 지시를 실을 수 있는지 명시**한다. 못 싣는 어댑터로 NPC 를 만들 때
       화면이 그 사실을 말해야 한다 — 조용히 무시하지 않는다.
  - **Acceptance:** CLI 어댑터 NPC 에게 회의 규칙을 주면 반영되거나, 반영되지 않는다는
    사실이 고용 화면에 표시된다. 단위 테스트가 어댑터별로 어느 쪽인지 고정한다.

## `npx tsc --noEmit` 이 기준선부터 더러워 타입 게이트로 쓸 수 없다 (2026-09-01 · Hermes 통합 작업 중 발견)

- [ ] **테스트 파일 11개에 타입 오류 48건이 상시로 있어, "tsc 깨끗함"을 CI·리뷰 게이트로 쓸 수 없다.**
  - **Live evidence:** `npx tsc --noEmit 2>&1 | grep -cE '^src/'` → **48**,
    오류 파일 11개. `feat/hermes-plugin-integration` 브랜치가 건드린 파일은 그중
    **0개**(자동 대조 확인). 기준선 커밋 `f34d886` 에서도 동일하게 48.
  - **Root cause:** 세 부류다.
    (1) `src/db/index.test.ts:12` — `TS5097: An import path can only end with a '.ts'
    extension when 'allowImportingTsExtensions' is enabled` (tsconfig 설정 문제)
    (2) `src/db/server-db.test.ts:191` — `TS2345`, `unknown` 을 좁히지 않고 콜백에 넘김
    (3) `src/lib/dev-constants.test.ts:21` — `TS2540: Cannot assign to 'NODE_ENV'`
    (테스트가 읽기전용 속성에 대입)
  - **Blast radius:** 새 코드에 타입 오류가 생겨도 기존 48건에 묻혀 안 보인다. 실제로 이번
    작업에서 구현자가 "기존 6파일"이라고 보고했다가 `tail` 로 잘린 것을 뒤늦게 정정했다 —
    사람이 눈으로 세는 방식이 이미 실패했다는 증거다.
  - **Direction:** (1) `npm run test` 처럼 `npm run typecheck` 를 두고 **0 을 요구**한다.
    (2) 그러려면 먼저 11개 파일을 정리해야 한다 — tsconfig 의 `allowImportingTsExtensions`
    같은 설정 한 줄로 해소되는 것과 실제 코드 수정이 필요한 것을 나눈다.
    (3) 그때까지의 임시 방편은 "변경된 파일에 새 오류가 없는가"를 대조하는 스크립트다.
  - **Acceptance:** `npx tsc --noEmit` 이 0 을 반환하고, CI 가 그것을 게이트로 건다.
    그 전까지는 파일 단위 대조 스크립트가 있고 리뷰 절차가 그것을 쓴다.

## `drizzle/meta/` 스냅샷이 0004부터 낡아 `drizzle-kit generate` 가 오염된 마이그레이션을 뱉는다 (2026-09-01 · Hermes 통합 작업 중 발견)

- [ ] **`drizzle-kit generate` 를 돌리면 이미 적용된 변경(local_discovery_* 컬럼 추가, openclaw_config DROP 등)까지 다시 포함한 마이그레이션이 생성된다.**
  - **Live evidence:** `0006` 을 만들려고 `npx drizzle-kit generate` 를 실행했더니 위 변경들이
    재포함된 파일이 나와 폐기하고 `0004_local_discovery_optin.sql` 형식을 손으로 따라 썼다
    (구현자 보고, task-4-report.md).
  - **Root cause:** `0004`·`0005` 가 스냅샷 갱신 없이 손으로 작성돼 `drizzle/meta/` 의 스냅샷이
    실제 스키마보다 뒤쳐져 있다. generate 는 스냅샷을 기준으로 diff 를 뜨므로 그 간극만큼을
    "새 변경"으로 오인한다.
  - **Blast radius:** 다음에 누가 무심코 `drizzle-kit generate` 를 돌리면 같은 일이 재발하고,
    검토 없이 커밋되면 **이미 적용된 DDL 을 재실행**한다. `ADD COLUMN IF NOT EXISTS` 는 멱등이라
    버티지만 `DROP` 이 섞이면 데이터가 사라진다.
  - **Direction:** (1) 현재 스키마 기준으로 `drizzle/meta/` 스냅샷을 재생성해 0006 까지의 상태와
    맞춘다. (2) 그게 어려우면 `package.json` 에서 generate 를 막고 "마이그레이션은 손으로 쓴다"를
    문서화한다 — 지금은 둘 다 아닌 어중간한 상태다.
  - **Acceptance:** 스키마를 바꾸지 않은 상태에서 `drizzle-kit generate` 가 **빈 마이그레이션**을
    내거나 아무것도 만들지 않는다.

## React 컴포넌트에 렌더 테스트 인프라가 없다 (2026-09-01 · Hermes 마법사 작업 중 발견)

- [ ] **`.test.tsx` 가 0개이고 jsdom/testing-library 가 미설치라, UI 로직 결함은 코드 추적으로만 확인되고 자동 회귀 방어가 전혀 없다.**
  - **Live evidence:** `fd -e test.tsx . src` → **0개**. `package.json` 에 `jsdom`·
    `@testing-library` 문자열 0건. `NpcHireWizard.tsx` 에서 발견된 Important 3건
    (충돌 배너가 스스로 꺼지며 사용자 초안을 덮어씀 / 삭제 실패가 침묵 / 진입 버튼 토글이
    정리 확인을 우회)은 전부 **되돌린 뒤 코드를 눈으로 따라가** 확인했다 — 테스트가 아니다.
  - **Root cause:** 테스트 러너가 `tsx --test`(node:test)이고 DOM 환경이 없다.
  - **Blast radius:** 상태 전이·조건부 렌더 버그가 리뷰를 통과하면 잡히지 않는다. 실제로
    이번 마법사에서 셋이 리뷰어의 **육안**으로만 잡혔다.
  - **Direction:** (1) `jsdom` + `@testing-library/react` 도입, `node:test` 와 함께 도는지
    확인(`tsx --test` 에 DOM 셋업 훅 필요). (2) 우선 대상은 상태 전이가 많은 컴포넌트 —
    `NpcHireWizard`(4단 마법사), `NpcHireModal`(1,108줄). (3) 순수 함수로 뺄 수 있는 판정은
    계속 빼되(이번에 `hire-wizard-steps.ts` 로 뺐다), 렌더·이벤트 결합은 뺄 수 없다.
  - **Acceptance:** 위 Important 3건 각각에 대응하는 렌더 테스트가 있고, 구현을 되돌리면
    실패한다.

## 오류 코드 사전이 "실제로 오는 코드"와 대조되지 않는다 (2026-09-01)

- [ ] **`wizard-error-codes.ts` 커버리지 테스트는 "사전에 있는 코드가 4로케일에 있는가"만 보고, "실제로 오는 코드가 사전에 있는가"는 보지 못한다.**
  - **Live evidence:** 플러그인은 `revision_mismatch` 를 내는데(`deskrpg_plugin/identity.py:142`)
    DeskRPG 사전에는 `revision_conflict` 만 있었다. 컨트롤러가 **라이브 게이트웨이에서
    낡은 `ifRevision` 을 재사용해** 409 `revision_mismatch` 를 받고서야 발견했다. 두 레포에
    걸친 이름이라 어느 쪽 테스트도 보지 못했다.
  - **Root cause:** 사전이 손으로 관리되고, 플러그인의 오류 코드 집합과 대조하는 장치가 없다.
  - **Blast radius:** 사용자가 그 실패를 만나면 영문 코드나 fallback 문구를 본다. 플러그인이
    코드를 추가·변경할 때마다 재발한다.
  - **Direction:** (1) 플러그인 레포가 오류 코드 목록을 기계가 읽을 형태로 내보내고
    (`GET /deskrpg/info` 의 `errorCodes` 배열 등), DeskRPG 테스트가 그것과 사전을 대조한다.
    (2) 그게 과하면 최소한 플러그인 README 의 코드 표를 단일 출처로 삼고 양쪽에 같은 상수를 둔다.
  - **Acceptance:** 플러그인에 새 오류 코드를 추가하고 사전에 안 넣으면 테스트가 실패한다.

## 클라이언트 컴포넌트가 `node:crypto` 를 끌고 들어갈 수 있다 (2026-09-01 · Hermes 통합 중 정적 추적으로 발견)

- [ ] **`app/channels/create/page.tsx`(`"use client"`)가 상수 하나 때문에 `lib/security-policy.ts` 를 import 하는데, 그 모듈은 최상단에서 `node:crypto` 를 import 한다.**
  - **Live evidence:** 81개 `"use client"` 파일의 import 그래프를 정적 추적한 결과 유일하게
    남은 서버 전용 의존 경로다(컨트롤러 실측):
    `app/channels/create/page.tsx → lib/security-policy.ts ⇒ node:crypto`
    클라이언트가 실제로 쓰는 것은 `CHANNEL_PASSWORD_MIN_LENGTH` 상수 하나뿐이다
    (`src/lib/security-policy.ts:1` 이 `import { randomBytes } from "node:crypto"`).
  - **Root cause:** 상수와 서버 전용 유틸이 한 모듈에 있다. 번들러가 트리셰이킹하면 살고
    못 하면 `Module not found` 로 페이지가 백지가 된다 — **운에 기대고 있다.**
  - **Blast radius:** 지금은 동작한다(빌드가 통과하므로). 그러나 `security-policy.ts` 에
    부수효과가 있는 import 가 하나만 더 들어오거나 번들러 설정이 바뀌면 그 페이지가 죽는다.
    **이번 브랜치에서 정확히 같은 모양의 사고가 실제로 났다** — `plugin-capability.ts` 가
    `@/db` 를 import 해 pg/better-sqlite3 가 번들에 들어갔고 클라이언트에서 쓰는 순간
    `Module not found: dns/fs/net/tls` 로 백지가 됐다. `npm run test` 도 `tsc` 도 Node
    환경이라 **원리적으로 못 잡는다.**
  - **Direction:** (1) 상수를 서버 전용 코드가 없는 모듈로 분리한다(이번에
    `plugin-cache-update.ts` 로 한 것과 같은 방식). (2) 재발 방지로 `"use client"` 파일의
    import 그래프에서 `node:`·`@/db`·`pg`·`better-sqlite3` 도달을 검사하는 테스트를 둔다 —
    정적 추적이라 실행 환경이 필요 없다.
  - **Acceptance:** 클라이언트 진입점에서 서버 전용 모듈에 닿는 경로가 0이고, 그것을
    검사하는 테스트가 있다.

---

## `useCallback` 이 예전 값을 붙잡고도 "저장했습니다" 를 띄운다 — 규칙은 있었고 꺼져 있었다 (2026-09-07 · **해결** `c8ad09da` `2d4d9e4e`)

- [x] **해결.** `react-hooks/exhaustive-deps` 를 `**/*.tsx`·`**/*.jsx` 에 `error` 로 켰다.
  이 규칙이 없는 동안 같은 결함이 최소 7개 살아 있었고, 그중 하나는 실 스테이징에서 잡혔다.
  - **Live evidence:** NPC 고용 마법사 설정 단계에서 effort 를 고르고 저장하면 화면은
    "저장했습니다" 를 띄우는데 파일에는 값이 없었다. 브라우저에서 `fetch` 를 감싸 실제 본문을
    확인: `{"model":"gpt-5.6-sol","provider":"openai-codex"}` — `reasoning_effort` 가 없고
    응답은 `{"applied":["model","provider"]}` 였다.
  - **Root cause:** `NpcHireWizard.tsx` 의 `handleSaveConfig` 의존성 배열에 `catalog`·`effort`
    가 없어 콜백이 **초기 렌더의 `catalog=null`** 을 붙잡고 있었다. 드롭다운은 최신 렌더가
    그리므로 화면은 멀쩡해 보인다 — 저장 경로만 과거에 산다.
  - **왜 어떤 게이트도 못 잡았나:** `npm run test`(959개)는 컴포넌트를 렌더하지 않고,
    `tsc` 는 타입만 본다. 규칙은 존재했지만 `eslint-config-next` 에서 켜져 있지 않았다.
  - **뮤테이션 검증:** 의존성을 되돌리면 eslint 가 정확히
    `missing dependencies: 'catalog' and 'effort'` 로 적색.
  - **함께 정리한 것:** 타일 에디터 17건. 상세는 아래 항목.

---

## 타일 에디터가 오래된 클로저를 17곳에 안고 있었다 (2026-09-07 · **해결** `2d4d9e4e`)

- [x] **해결.** 사이트별로 읽고 분류해 전부 닫았다. 규칙을 전역으로 켤 수 있게 된 전제 조건이었다.
  - **실제 결함(의존성 추가):**
    - 레이어 오버레이를 껐다 켜도 캔버스가 다시 그려지지 않았다 — `MapCanvas.tsx` 렌더
      `useEffect` 에 `layerOverlayMap` 이 없었다. 토글은 `setLayerOverlayMap` 만 바꾸므로
      다른 무엇도 리렌더를 유발하지 않는다.
    - 선택 영역 안을 끌면 이동 대신 **새 선택**이 시작됐다 — `handleMouseDown` 이
      `state.selection` 을 예전 값(대개 `null`)으로 붙잡았다. 의존성은 `state.mapData`·
      `state.tool` 등 하위 필드만 나열해, 선택만 바뀌면 콜백이 재생성되지 않는다.
    - 스탬프·붙여넣기 미리보기 커서가 따라오지 않았다(`handleMouseMove`).
    - 픽셀 에디터에서 선택 후 변형 모드 진입·핸들 커서가 먹지 않았다.
    - 스탬프 크기를 바꿔도 격자가 예전 크기로 그려졌다(`StampEditorModal` renderCanvas).
    - 단축키가 예전 `pushUndo`/`renderCanvas`/`trimEdges` 를 불렀다.
  - **먹지 않던 억제 주석:** 그 단축키 훅에는 `// eslint-disable-line react-hooks/exhaustive-deps`
    가 **닫는 줄(`], );`)에** 붙어 있었다. 규칙은 훅 시작 줄을 지목하므로 억제가 성립하지 않았고,
    누군가 "알고 넘어갔다"고 믿은 자리가 사실은 아무 보호도 없었다.
  - **죽은 의존성(제거):** `isCollisionLayer`(본문에서 안 읽힘 — 정의 자체가 사문),
    `applyResize` 의 `tilesetInfo`, `handleMouseMove` 의 `getTileCoord`,
    `handleEditPixels` 의 `layers`/`tilesets`(일부러 ref 로 최신값을 읽는다),
    `handleLayerClick` 은 전부.
  - **의도적 예외:** `StampEditorModal` 초기화 훅은 `stamp.id` 로만 돌아야 한다 — 의존성을
    채우면 부모가 객체를 새로 만들 때마다 편집 중인 내용이 날아간다. 이유를 적은
    `eslint-disable-next-line` 으로 남겼다.
  - **밟은 함정:** `trimEdges` 는 정의가 그 훅보다 **아래**라 의존성에 넣으면 TDZ 로 터진다.
    `tsc` 가 `TS2448 Block-scoped variable 'trimEdges' used before its declaration` 로 잡았다.
    정의를 훅 앞으로 옮겨 해결했다. 의존성 배열은 렌더 시점에 평가된다는 사실이 여기서 드러난다.
  - **Live 검증:** test.deskrpg.com 맵 에디터에서 오버레이 토글 전후 캔버스 픽셀 해시가
    1781170 → 1767070 → (되돌리면) 1781170. 맵은 원상 복원했고 저장하지 않았다.

---

## 컴포넌트를 렌더하는 테스트가 하나도 없다 (2026-09-07 · **해결** — 인프라 + 회귀 2건)

- [x] **해결.** `.test.tsx` 가 0개였고, 이번 세션의 UI 결함 2건이 전부 959개 초록을
  통과했다. 러너 glob 이 `.tsx` 를 아예 수집하지 않았고 렌더 라이브러리도 없었다.
  - **인프라:** `happy-dom` + `@testing-library/react`(devDependency), `tsx --test` glob 에
    `"src/**/*.test.tsx"` 추가, `src/test-setup/dom.ts` 가 전역을 심는다.
    **밟은 함정:** Node 22 의 `navigator` 는 getter 라 단순 대입이 `TypeError` 다 —
    전부 `Object.defineProperty` 로 심는다. React 19 는 `IS_REACT_ACT_ENVIRONMENT`
    가 없으면 상태 갱신마다 경고를 쏟는다.
  - **회귀 1 — 저장 본문:** 설정 저장이 고른 `reasoning_effort` 를 PUT 본문에 싣는지.
    뮤테이션 검증: `handleSaveConfig` 의 의존성을 되돌리면 적색
    ("고른 effort 가 본문에서 사라졌다").
  - **회귀 2 — 강등:** 카탈로그 요청이 502 면 드롭다운 대신 직접 입력으로 떨어지는지.
    강등이 없으면 게이트웨이가 목록을 못 줄 때 모델을 **아예 지정할 수 없다**.
    뮤테이션 검증: `{catalog ? …}` 조건을 없애면 적색.
  - **원래 Acceptance 를 수정했다(정직하게 남긴다).** 처음엔 "오버레이 토글이 렌더를
    유발하는가" 를 두 번째 회귀로 적었으나, 그 부류는 이제 `exhaustive-deps` 가
    프로젝트 전역에서 막고(뮤테이션 검증 완료) 캔버스 재렌더를 관측하려면
    `useCanvasRenderer` 모듈 모킹이 필요해 비용 대비 값이 낮다. 대신 **순수 함수
    테스트로도 lint 로도 볼 수 없는** 배선(요청 본문, 실패 시 강등)을 덮었다.
  - **범위:** 전면 커버리지는 목표가 아니다. 규칙이 보는 것은 규칙에, 못 보는 배선만
    여기에 둔다.

---

## 순수 모듈이 서버 전용 모듈을 끌어들여도 아무 게이트가 막지 못한다 (2026-09-07 · **해결** `<이 커밋>`)

- [x] **해결.** import 그래프를 따라가는 경계 테스트를 추가하고
  (`src/lib/client-bundle-boundary.test.ts`), 잠복해 있던 실제 경로 하나를 끊었다.
  - **Live evidence (실제 사고, 이전):** `plugin-capability.ts` 가 `@/db` 를 import 하면서
    pg·better-sqlite3 가 클라이언트 번들로 끌려가 페이지가 백지가 됐다. `npm run test` 도
    `tsc` 도 잡지 못했다.
  - **Live evidence (잠복, 이번에 발견):** `src/app/channels/create/page.tsx` 는
    `"use client"` 인데 상수 하나(`CHANNEL_PASSWORD_MIN_LENGTH`) 때문에
    `@/lib/security-policy` 를 가져왔고, 그 파일 1번째 줄이
    `import { randomBytes } from "node:crypto"` 였다. 깨지지 않은 이유는 번들러가 미사용
    import 를 떨어냈기 때문이고, 즉 보호가 트리셰이킹이라는 우연에 걸려 있었다.
  - **수정:** 난수를 쓰는 `generateChannelInviteCode` 를 `src/lib/invite-code.ts` 로 분리했다.
    `security-policy.ts` 에는 클라이언트·서버가 함께 쓰는 순수 정책 값만 남고 `node:*` 가 없다.
  - **가드:** 테스트가 `"use client"` 파일에서 출발해 `@/`·상대 경로 import 를 따라가며
    `node:*`·`@/db`·`pg`·`better-sqlite3`·`drizzle-orm/node-postgres` 도달 여부를 본다.
    실패 시 **경로 전체**를 출력하므로 어디를 끊을지 바로 보인다.
  - **뮤테이션 2건 검증:**
    (A) `security-policy.ts` 에 `node:crypto` 를 되돌림 → 적색,
    `app/channels/create/page.tsx → lib/security-policy.ts → node:crypto` 출력.
    (B) 과거 사고 재현 — `plugin-capability.ts` 에 `@/db` 추가 → 적색, 3개 경로 출력
    (`app/gateways/page.tsx → … → hire-wizard-steps.ts → plugin-capability.ts → @/db`).
  - **한계 (알고 남긴다):** 정적 `import` 문만 본다. 동적 `import()` 와 `require()` 는
    따라가지 않는다. 외부 패키지 내부도 들여다보지 않는다. 그 부류는 여전히 잡히지 않는다.

---

## 프로젝트 로드 실패를 `alert()` 로 알리고 목록으로 튕긴다 (2026-09-07 · **해결**)

- [x] **해결.** `alert()` + 자동 리다이렉트를 인라인 상태로 바꿨다. 사유가 화면에
  남고, 사용자가 스스로 목록으로 간다.
  - **처음 진단은 오진이었다(남겨 둔다).** "스피너에서 영영 멈춘다" 고 적었으나
    재확인 결과 실패 경로는 동작하고 있었다. 자동화 브라우저에서 본 멈춤은
    (1) 그 URL 의 프로젝트가 실은 200 이었고 (2) 콘솔의 `Failed to load project` 는
    같은 탭의 **이전** 내비게이션에서 남은 것이었다. 한 탭에서 두 내비게이션을
    구분하지 않은 것이 원인이다.
  - **그래도 고칠 값이 있었다:** `alert()` 는 페이지를 막고, 문구를 다듬을 수 없고,
    확인을 누르면 사유를 다시 볼 방법이 없다. 새 키를 만들지 않고 기존
    `mapEditor.project.browserTitle` 을 링크 라벨로 재활용했다(4개 로케일 수정 불필요).
  - **Live 검증:** 없는 프로젝트 id 두 개로 확인 —
    "요청한 리소스를 찾을 수 없습니다" + "내 프로젝트" 링크가 뜬다. 모달 없음.
  - **밟은 것 하나:** 배포 직후 첫 요청이 콜드 스타트로 오래 걸려 다시 "로딩 중" 에
    머무는 것처럼 보였다. 두 번째 id 로는 즉시 정상 — 원 오진과 같은 착시다.

---

## lint 와 tsc 가 초록이 아니라 CI 게이트로 쓸 수 없다 (2026-09-07 · **tsc 는 해결**, eslint 남음)

- [x] **tsc 0건.** 48 → 0. 전부 테스트 파일이었고 프로덕션 코드는 원래 깨끗했다.
  - `task-manager.test.ts` 30건: 타입 없는 `task-manager.js` 를 `Record<string, unknown>`
    으로 선언해 `task.id` 가 `unknown` 이라 다음 호출에 못 넘겼고(20건), 널 가능성도
    가려졌다(10건). 읽는 필드만 담은 `TaskRow` 로 바꾸고, `moveTask` 가 실제로 null 을
    반환하는 세 갈래(대상 없음 / 예상 상태 불일치 / 동시 이동)에 `assert.ok(moved, …)` 를
    넣었다 — **테스트가 더 나아졌다.** 예전엔 그 회귀가 모호한 TypeError 로만 드러났다.
  - TS5097 5건: 테스트가 `.ts` 확장자로 import 했다. `allowImportingTsExtensions` 를 켜서
    tsconfig 를 흔드는 대신 확장자를 뗐다(tsx·bundler 둘 다 해석한다).
  - `error-codes.test.ts`: `TEST_CODES` 가 `Record<ErrorCode, string>` 이라고 주장하며
    127개 중 96개만 담고 있었다. **전수 검사는 이미 다른 두 테스트**(로케일 커버리지,
    라우트 스캔)**가 한다** — 여기 다 나열하면 `ERROR_MESSAGE_KEYS` 를 베껴 자기 자신과
    비교하는 꼴이라 `Partial<...>` 이 정직하다.
  - `npc-response-messages.test.ts`: 같은 모양이지만 여기는 **전수 검사가 없었다.**
    12개 중 5개만 있던 목록을 채우고, 에러코드 쪽에만 있던 **로케일 커버리지 가드를
    NPC 시스템 메시지에도 추가**했다. 뮤테이션 검증: `ko.ts` 에서 `npc.taskOwnerUnknown`
    을 지우면 적색.
  - `meeting-minutes.ts`: 반환 타입 추론이 리터럴 인자에서 `never` 로 접혔다. 명시했다.
  - `dev-constants`·`server-db`: `NODE_ENV` 읽기 전용, `all()` 의 `unknown[]`.

- [x] **eslint 0 errors.** 48 → 0. 규칙별로 갈라서 처리했다.
  - **`no-require-imports` 31건:** `.js`/`.cjs`/`.mjs` 는 이 저장소에서 **설계상
    CommonJS** 다(`server.js` 가 빌드 없이 그대로 require 한다) — 규칙이 사실과
    어긋나는 경우이므로 그 파일들에서 껐다(17건). 나머지 14건은 `.ts` 가 런타임
    CommonJS 모듈을 타입 캐스팅해 부르는 의도적 패턴이라 사이트마다 사유를 남겼다.
  - **같은 함정이 또 나왔다.** 기존 disable 주석들이 `const X =` 줄 위에 있는데
    `require(` 는 **줄바꿈 뒤 다음 줄**이라 적용되지 않고 있었다. 즉 "알고 넘어갔다"
    고 믿은 자리가 실제로는 무방비였다. disable 은 **규칙이 지목하는 줄** 바로 위에
    둔다 — 이 세션에서 세 번째로 만난 같은 부류다.
  - **`no-explicit-any` 13건:** 대부분 이미 있는 타입을 안 쓰고 있었다.
    `src/lib/stamp-utils.ts` 의 `StampData`/`StampListItem`/`StampLayerData`/
    `StampTilesetData` 를 쓰고, 두 곳에 인라인으로 반복되던 스탬프 변경 모양에
    `StampLayerChange` 라는 이름을 줬다.
    **`any` 가 실제 결함을 가리고 있던 곳이 하나 있다** — `GamePageClient` 의
    `channelNpcs` 상태 타입에 `hasAgent` 가 없는데 `npc.hasAgent` 를 읽고 있었다
    (`/api/npcs` 는 실제로 보낸다). 타입을 응답에 맞췄다.
  - **`react-hooks/*` 4건:** `PixelEditorModal` 의 `handlePanEnd` 가 **자기 자신을
    선언 전에 참조**하고 있었다 — `handlePanMove` 에 의존성이 하나라도 생기는 순간
    팬 도중 리스너가 남는다(마우스를 떼도 계속 끌린다). 이름 붙인 함수 표현식으로
    바꿔 자기 자신을 정확히 지우게 했다. 나머지 3건(`set-state-in-effect`)은
    prop 변화에 상태를 맞추는 정당한 패턴이라 사유를 적은 disable 로 남겼다.
  - **미사용 변수 경고 70 → 55:** 밑줄 접두 관례(`_fromStatus` 등)를 규칙에 알렸다.
    남은 것은 진짜 죽은 코드이므로 별건으로 둔다 — 경고는 게이트가 아니다.

- [x] **CI 에 lint 단계가 아예 없었다.** 추가했다. 그리고 `typecheck` 가
  `tsconfig.ci.json` 으로 **테스트 파일을 통째로 제외**하고 있었다 — 그래서 48건이
  CI 에 한 번도 보이지 않았다. 0으로 만들었으므로 제외를 없애고 `tsc --noEmit` 로
  바꿨다(`tsconfig.ci.json` 삭제).
  - **로컬과 CI 가 다르던 문제도 닫았다.** `npm run lint` 가 `.claude/worktrees`
    까지 훑어 759건을 뱉고 있었다(gitignore 라 CI 는 못 보는 경로). ignore 에 추가해
    로컬 결과가 CI 와 같아졌다.
  - 로컬 실측: `test` 964 통과 · `typecheck` 0 · `lint` 0 · `format:check` 0 ·
    `next build` 성공.

---

## `drizzle/meta` 스냅샷이 3개 뒤처져 있다 — 다음 `generate` 가 DROP 을 뱉는다 (2026-09-07 · **해결** `12d7fbea`)

- [x] **해결.** 위험이 추측이 아니라 실측으로 확인됐고, 스냅샷 사슬을 현재로 맞춰 닫았다.
  - **Live evidence:** 스냅샷이 0003 에서 멈춘 상태로 `drizzle-kit generate` 를 실행하니
    0004~0006 의 변경 전체를 다시 뱉었고, 그 안에
    `ALTER TABLE "npcs" DROP COLUMN "openclaw_config";` 가 있었다.
    **`IF EXISTS` 도 없고, 0005 의 데이터 이전 단계도 없다** — 0005 는 그 삭제 전에
    페르소나를 `agent_config` 로 옮기고 레거시 OpenClaw 행을 `npcs_openclaw_backup` 에
    남긴다. 생성된 SQL 을 읽지 않고 적용하면 모든 NPC 의 페르소나가 사라진다.
  - **수정:** `0007_align_snapshot.sql`(실행할 SQL 이 없다 — `SELECT 1;`)과 현재
    `schema.ts` 를 담은 `meta/0007_snapshot.json` 을 넣었다. 0004~0006 의 실제 변경은
    각자의 파일이 이미 수행하므로 신규 DB 도 순서대로 올바르게 만들어진다.
  - **검증:** (1) `drizzle-kit generate` → `No schema changes, nothing to migrate`.
    (2) 빈 PostgreSQL 16 컨테이너에 `drizzle-kit migrate` 로 0000~0007 전부 적용 →
    `__drizzle_migrations` 8행, `npcs` 에 `agent_config` 존재·`openclaw_config` 없음,
    `gateway_resources` 에 `plugin_status`/`plugin_version`/`plugin_checked_at` 존재.
  - **가드:** `migration-journal.test.ts` 에 "마지막 마이그레이션에 짝이 되는 스냅샷이
    있다" 를 추가했다. 손으로 SQL 을 쓰는 관행은 막지 않되, 사슬이 끊기면 적색이 된다.
    뮤테이션 검증: `0007_snapshot.json` 을 치우면 적색.

---

## 미사용 변수 경고 55건을 정리하다 결함 셋을 찾았다 (2026-09-08 · **해결**)

- [x] **해결.** eslint 경고 79 → 1. 부류별로 갈라서 처리했고, 세 곳은 경고가 실제
  문제를 가리키고 있었다.
  - **죽은 테스트 하나:** `dev-constants.test.ts` 의 "consistent across imports" 는
    두 모듈을 `await import` 해 놓고 **가져온 값을 쓰지 않은 채** 앞 테스트와 같은
    단언만 했다. 즉 이름이 주장하는 것을 한 번도 검증하지 않았고 어떤 회귀로도
    빨개질 수 없었다. 실제로 깨지는 경로(누군가 비밀 리터럴을 자기 파일에 다시
    적는 것)를 검사하도록 다시 썼다. 뮤테이션 검증: `jwt.ts` 에 리터럴을 심으면 적색.
  - **죽은 이동 계산:** `GameScene` 의 `nextX/nextY` → `nextTileX/nextTileY` 는
    아무 데서도 쓰이지 않았다. 실제 이동 판정은 `checkX` 로 따로 한다. 잔재였다.
  - **도달할 수 없는 기능:** `handleCleanUpUnused`(사용하지 않는 타일셋 정리)는
    리듀서(`REMOVE_UNUSED_TILESETS`)까지 끝까지 구현돼 있는데 **UI 진입점이 없다.**
    아무도 호출하지 않는다. 지우지 않고 남겼다 — 아래 별도 항목.
  - 나머지는 기계적이었다: 미사용 import 제거, 파라미터·구조 분해에 `_` 접두,
    순수 표현식인 죽은 지역 변수 삭제, 죽은 `useCallback` 둘 제거.
  - **`<img>` 9건:** 전부 런타임 data URL(썸네일·타일셋 base64·마크다운 이미지)이라
    `next/image` 가 최적화할 수 없다. 사이트별 disable 을 먼저 시도했으나 9곳 중
    5곳이 **삼항 분기 안**이라 JSX 주석도 `//` 도 문법 오류가 된다 — 설정에서
    사유와 함께 껐다. 정적 자산에 `<img>` 를 쓰는 새 코드가 생기면 재검토 대상이다.

---

## 사용하지 않는 타일셋 정리 기능에 진입점이 없다 (2026-09-08 · **해결**)

- [x] **해결.** 타일셋 패널 헤더에 정리 버튼(지우개)을 붙였다.
  - **원래 상태:** 리듀서(`REMOVE_UNUSED_TILESETS`)와 핸들러가 끝까지 구현돼
    있었는데 `handleCleanUpUnused` 를 참조하는 곳이 **선언 한 줄뿐**이었다.
    관련 i18n 키(`removeUnusedConfirm`)도 4개 로케일에 이미 있었다 — 붙이는 것만
    빠져 있었다.
  - **지울 것이 있을 때만 버튼을 띄운다.** 그래서 미사용 목록을 `unusedTilesets`
    memo 로 올렸다(예전엔 핸들러 안에서만 계산했다). 없을 때도 버튼이 보이면
    눌러도 아무 일이 없어 고장으로 읽힌다. 툴팁에 개수를 넣었다.
  - **되돌릴 수 없다는 사실을 확인 문구에 넣었다.** `REMOVE_UNUSED_TILESETS` 는
    `undoStack` 에 쌓이지 않고 `tilesetImages` 까지 함께 지운다 — 확인 후에는
    저장하지 않는 것 말고는 복구 수단이 없다. 4개 로케일 모두 수정.
  - **회귀 테스트:** `unused-tilesets.test.ts` 가 (1) 핸들러 참조가 선언뿐이
    아닌지, (2) `onClick` 이 연결됐는지, (3) 버튼이 조건부인지를 소스에서 고정한다.
    렌더 테스트가 더 낫지만 이 컴포넌트는 캔버스·컨텍스트 의존이 커서 마운트가
    비싸다. 뮤테이션 검증: `onClick` 을 떼면 적색.
  - 검증: test 966 · typecheck 0 · **lint 0(경고 포함)** · build 성공.

---

## 정리 기능이 사용자가 가져온 타일셋까지 지운다 (2026-09-08 · **해결** — 노출 직후 실측에서 발견)

- [x] **해결.** 판정 기준을 "맵에 배치된 타일이 없음" 에서 "**편집이 자동 생성한 것**"
  으로 좁혔다.
  - **Live evidence:** 버튼을 붙인 직후 스테이징에서 눌러 보니 대상이 16개였는데,
    그중 4개가 사용자가 직접 가져온 타일셋이었다 —
    `small-office-furniture1`, `small-office-furniture2`, `small-office-equipment`,
    `dante-labs-tileset`. 팔레트에서 실제로 사라지는 것을 확인했다.
    **저장 전에 알아채 새로고침으로 되돌렸다**(DB 백업도 미리 떠 뒀다).
  - **Root cause:** "미사용" 을 *지금 배치된 타일이 하나도 없음* 으로 정의했다.
    나중에 쓰려고 올려둔 타일셋은 정의상 항상 여기 걸린다. 즉 기준이 이름보다 넓었다.
  - **올바른 경계는 이미 코드에 있었다.** 팔레트가 `stamp-*` 와 `edited-selection-*`
    를 숨긴다 — 사용자가 고르라고 만든 것이 아니기 때문이다. 정리 대상도 정확히
    그 집합이어야 한다. `isGeneratedTilesetName()` 로 술어를 추출해 팔레트 필터
    두 곳과 정리 로직이 **같은 정의**를 쓰게 했다(중복도 없앴다).
  - **문구도 고쳤다.** "사용하지 않는" → "편집 과정에서 생긴", 그리고 "직접 가져온
    타일셋은 지우지 않습니다" 를 넣었다. 4개 로케일.
  - **회귀 테스트:** 그날 실제로 목록에 오른 이름들로 양쪽을 고정했다. 접두사로만
    판단한다는 것도 함께(`my-stamp-pack` 은 대상이 아니다).
    뮤테이션 검증: 옛 기준으로 되돌리면 사용자 자산 4개에서 적색.
  - **교훈:** 기능을 화면에 노출하는 것과 그 기능이 옳은지는 별개다. 진입점이
    없던 동안에는 판정 기준이 틀렸다는 사실도 드러날 수 없었다.

---

## 타일셋 정리가 `project_tilesets` 링크를 남긴다 (2026-09-08 · 스테이징 실측)

- [ ] **정리 후 저장하면 `tiled_json` 에서는 사라지는데 링크 테이블에는 그대로 남는다.**
  - **Live evidence:** `Dante Labs PJT` 에서 편집 잔재 12개를 정리하고 저장한 뒤
    (test.deskrpg.com, 2026-09-08 02:29 UTC):
    - `jsonb_array_length(tiled_json->'tilesets')` : 42 → **30** ✅
    - `select count(*) from project_tilesets where project_id=…` : 42 → **42** ❌
    - 그중 `stamp-%`/`edited-selection-%` 이름이 붙은 링크가 **36개** 남아 있다.
  - **Root cause:** `src/app/api/projects/[id]/route.ts:81` 의 PUT 은 `projects` 행만
    갱신한다(`updates.tiledJson`). `project_tilesets` 를 지우거나 다시 세우는 코드가
    없다. GET(`:36`)은 그 테이블을 읽어 타일셋 목록을 만든다.
  - **왜 화면에는 안 보였나:** 로드는 `getProjectMapDataForLoad(project.tiledJson,
    tilesets)` 로 둘을 합치는데, `tiled_json` 에 없는 타일셋은 팔레트에 뜨지 않는다.
    즉 **DB 에만 남고 화면에는 없다** — 조용히 쌓인다.
  - **Blast radius:** 정리를 눌러도 DB 무게는 줄지 않는다. 정리 기능의 목적(저장
    페이로드·자원 정리)이 절반만 달성된다. 링크가 가리키는 `tileset_images` 행도
    참조가 남아 있으니 지워지지 않는다.
  - **Direction:** (1) PUT 에서 `tiledJson.tilesets` 를 정본으로 삼아
    `project_tilesets` 를 동기화한다(없는 것은 삭제, 새로운 것은 삽입).
    (2) 다른 프로젝트가 참조하지 않는 `tileset_images` 행의 정리는 **별개 판단**이다 —
    이 테이블은 프로젝트 스코프가 아니라 전역이다(`project_id` 컬럼이 없다).
    같이 지우면 다른 프로젝트를 깨뜨릴 수 있으니 참조 수를 먼저 세야 한다.
  - **Acceptance:** 정리 후 저장하면 `project_tilesets` 의 행 수가
    `jsonb_array_length(tiled_json->'tilesets')` 와 같아진다. 테스트가 그 등식을 고정한다.

## NPC 프로필 단일 소유 — 스테이징 실측 (2026-09-08 · test.deskrpg.com live, branch `feat/npc-profile-ownership`)

- [x] **설계 스펙 `docs/superpowers/specs/2026-09-08-npc-프로필-단일소유-설계.md` 의 8항목 체크리스트를 스테이징에서 실측했다. 8/8 통과. 아래는 증거와, 실측 중 드러난 미해결 3건.**
  - **Live evidence:**
    1. `/gateways` 외형 편집 → `PATCH /api/hermes/profiles/:id` 200, DB `hermes_profiles.appearance` 갱신.
    2. 입장 시 출근부 = 올리버 `자리 미정` · 소피 `자리 있음`(11,7). 맵엔 소피만.
    3. 올리버 `자리 미정` → 칸 클릭 → (13,7) 에 **바꾼 외형(body=black, hair=chestnut)** 으로 스폰. `NPC 2명 출근`.
    4. 소피 퇴근 → 스프라이트 제거, `active=false`, 자리 (11,7) 보존 → 출근 → 같은 자리에 재스폰.
    5. 회의 진행 중 소켓 `npc:set-active {active:false}` → 요청 소켓에만 `npc:set-active:error {errorCode:"npc_in_meeting"}`, `npc:updated` 방송 없음, `active` 그대로.
    6. `[+ 새 직원]` → `/gateways?gateway=dbf7290c…&new=1&returnTo=%2Fgame%3FchannelId%3D…` (게이트웨이 선선택, 마법사 열림) → `사무실로 돌아가기` → 같은 게임 URL 복귀. 프로필 생성은 토큰 입력이 필요해 사용자 몫.
    7. 게이트웨이 DELETE 200(409 없음) → PUT 200 → 소피 자리 (11,7) 보존, 올리버는 자리 미정으로 재고용.
    8. `select count(*) from npcs where hermes_profile_id is null` = 0, `npcs_unprofiled_backup` 존재.
  - **함정(코드 결함 아님):** 배포 직후 맵 타일이 안 보였다. Phaser 씬·레이어·텍스처·카메라 전부 정상, `document.hidden=true` 라 렌더 루프가 0프레임이었다(`e2e/README.md` 의 "가려진 창의 rAF 스로틀"). 탭을 전면으로 올리자 정상. 같은 캐릭터로 두 번째 탭을 열면 첫 탭이 `/channels` 로 튕기고 **진행 중 회의가 끝난다** — 회의 가드 실측은 같은 탭에서 소켓 직접 emit 으로 했다.

- [ ] **업그레이드 시 기존 바인딩에 자동 출근이 소급되지 않는다.** 마이그레이션 0008 은 `npcs` 행을 옮길 뿐, 이미 묶여 있던 채널의 프로필을 새로 고용하지 않는다. 올리버는 게이트웨이를 해제→재연결한 뒤에야 출근부에 나타났다.
  - **Root cause:** `drizzle/0008_npc_profile_ownership.sql` · `src/db/sqlite-npc-profile-ownership.js` 에 백필 단계 없음; 고용은 `hireGatewayProfilesIntoChannel()` (`src/lib/npc-roster.ts`) 이 바인딩 PUT 에서만 호출.
  - **Blast radius:** 릴리스 후 기존 사용자 전원 — 맵에 안 나오던 프로필은 재연결 전까지 출근부에 없다.
  - **Direction:** (1) 마이그레이션 마지막 단계에서 `channel_gateway_bindings × hermes_profiles` 를 조인해 없는 `(channel_id, hermes_profile_id)` 를 `active=false`(자리 미정) 로 삽입, 또는 (2) 서버 기동 시 1회 백필. (1) 이 정본에 가깝다.
  - **Acceptance:** 바인딩된 채널 + 미고용 프로필을 시드한 DB 에 마이그레이션을 적용하면 출근부에 그 프로필이 `자리 미정` 으로 보인다. `npc-profile-migration.test.ts` 에 케이스 추가.

- [ ] **NPC 고용 마법사 ④배치 문구가 구 플로우를 가리킨다.** "채널로 이동해 'NPC 고용'을 열고 이 프로필을 선택하세요" — 이제 `NPC 고용` 모달은 없고 출근부에서 `자리 미정` 을 누른다.
  - **Root cause:** `src/lib/i18n/locales/ko.ts:272` (`hermes.wizard.*` 배치 안내), en 도 동일 추정.
  - **Direction:** "채널 출근부에서 이 프로필의 `자리 미정` 을 눌러 칸을 고르세요" 로 교체(ko/en).
  - **Acceptance:** 문자열에 `NPC 고용` 이 남지 않는다. i18n 키 테스트가 있으면 그걸로 고정.

- [ ] **퇴근시킨 NPC 의 말풍선(`•••`) 이 맵에 남는다.** 소피 퇴근 후 스프라이트는 사라졌지만 그 자리의 대기 말풍선이 그대로였다.
  - **Root cause:** `GameScene.ts` 의 `npc:updated`(active=false) 처리가 스프라이트만 제거하고 말풍선/이름표 컨테이너를 같이 지우지 않는 것으로 추정 — 코드 확인 필요.
  - **Acceptance:** 퇴근 직후 해당 NPC 의 말풍선·이름표가 화면에 없다.

## NPC 프로필 단일 소유 — 최종 리뷰 후속 (2026-09-09 · 브랜치 `feat/npc-profile-ownership`)

최종 리뷰(Critical 1 · Important 9 · Minor 8)와 픽스 웨이브(`1ff926d7..2b60d700`) 결과. 위 "스테이징 실측" 절의 미해결 3건(백필·마법사 문구·말풍선)은 **이 웨이브에서 해결**됐다 — 0009 백필 마이그레이션, `hermes.wizard.placement.guide` 4로케일, `removeNpcById` 의 말풍선 정리.

- [x] **닫힘** — C1 자식 테이블 백업(`npcs_removed_*_backup`) · I1 회의 규약 폴백 · I2 휴면 NPC 대화 제외(`includeDormant`) · I3 409 배치 모드 유지+토스트 · I4 백필 · I5 `safeReturnTo` 탭 우회 · I6 `/api/npcs` 채널 접근 검사 · I7 말풍선 · I8 마법사 문구/제목 · I9 CI PostgreSQL 서비스 · M2 M3 M6 M7. 프로덕션(deskrpg.com) 실측: `npcs` 0건, `channels` 0건, 마이그레이션 0000 만 적용(앱 0.1.1) — 0008 의 파괴 경로는 프로덕션에서 빈 집합에 돈다.

- [ ] **`resolveMeetingMinutesAccess` 는 이제 범용 채널 접근 판정이다 — 이름과 위치를 옮긴다.** `/api/npcs` 가 재사용하면서 회의록 전용이라는 이름이 거짓이 됐다. 리뷰 Recommendation 3 이 지적한 대로 채널 멤버십 검사가 빠진 라우트가 더 있는지 함께 훑는다.
  - **Direction:** `src/lib/rbac/channel-access.ts` 류로 옮기고 `resolveChannelAccess` 로 개명; 채널 UUID 를 받는 GET 라우트 전부에 적용 여부 표를 만든다.
  - **Acceptance:** 채널 UUID 를 받는 모든 GET 라우트가 비멤버에게 403/404 를 준다는 테스트 표.

- [ ] **`NpcConfig.meetingProtocol` 필드가 폴백 없이 `null` 로 실린다.** `instructions` 는 `resolveMeetingProtocol()` 폴백을 쓰지만 필드 자체는 아니다(`socket-handlers.ts` 조립 지점 2곳). 지금은 읽는 소비자가 없어 무해하나 값이 엇갈려 있다. 다음 릴리스에서 `agent_config` 를 지울 때 폴백을 프로필/채널 설정으로 옮기며 같이 정리한다(리뷰 Recommendation 4).

- [ ] **SQLite 백필이 이관 실행에 묶여 있다.** `active` 컬럼이 이미 있는 개발 DB(이 브랜치의 이전 빌드)는 `migrateNpcsToProfileOwnership` 이 조기 반환해 0009 상당의 백필을 받지 못한다. 릴리스 전 개발 설치만 해당 — 릴리스 후 신규 이관은 정상. 테스터가 "백필이 안 됐다"고 보고하면 이것이다.

- [ ] **런타임 이미지에 `src/db/*.test.ts` 가 실린다.** `COPY --from=builder /app/src/db ./src/db` 디렉터리 복사의 부작용. Dockerfile 이 `src/lib/hermes` 에 대해 이미 인정한 성질이라 새 문제는 아니나, `.dockerignore` 또는 COPY 뒤 `rm` 으로 정리할 수 있다.

- [ ] **Parked(리뷰 Minor):** M1 `npcs_appearance_conflicts` 가 외형이 같아도 쌓인다(`IS DISTINCT FROM` 누락) · M4 hire 의 select-then-insert 경합(`isUniqueViolation` catch 로 흡수 가능) · M5 `npcCount` 가 채널마다 3테이블 조인 전체 조회(N+1) · M8 `hasNpcPresetDefaults` 호출부 0 · T9 `meetingNpcIds` 빈 집합(회의 시작 시 참가자 명단으로 사전 비활성화 가능) · 백업 테이블 정리 시점(T1 후속, 이제 8개).

## 소켓이 재연결되면 채널 채팅·NPC 지명이 조용히 죽는다 — 헤더는 "AI 연결" 초록 (2026-09-09 · test.deskrpg.com live, 2026.9.9 · **해결** `fix/socket-rejoin` 56fd99a2·3055262a·87e32514)

- [x] **`player:join` 은 씬 생성 때 한 번만 보내고, socket.io 가 재연결해 새 `socket.id` 를 받아도 다시 보내지 않는다. 서버의 `players` 맵은 옛 id 로만 채워져 있으므로, 재연결 뒤의 `chat:send` 는 `players.get(socket.id)` 가 undefined 라 첫 줄에서 조용히 리턴한다. 사용자는 메시지가 지워지는 것(전송된 것처럼)만 보고, 채팅창에는 아무것도 남지 않으며, 에러도 토스트도 없다.**
  - **Live evidence:** 회의실 왕복 후 채널 채팅에 `@[소피] @[올리버] …` 전송 → 입력창은 비워졌으나 패널은 "아직 메시지가 없습니다" 그대로. 같은 소켓으로 `socket.emit("chat:send",{message:"echo test"})` 를 두 번 보내도 `onAny` 로 받은 이벤트 0건(`chat:message` 에코 없음), `connected:true`, 서버 로그 무출력. 새로 고침(새 `player:join`) 직후 같은 메시지 → `chat:message` 에코 + `npc:come-to-player` ×2 + 두 NPC 응답 정상.
  - **Root cause:** `src/game/scenes/GameScene.ts:3018` `joinMultiplayer()` 호출부는 `:1729`·`:2989` 뿐(씬 생성/스폰). `src/app/game/GamePageClient.tsx:553` 의 `connect` 핸들러는 `task:list` 만 다시 보낸다. 서버 `src/server/socket-handlers.ts:1545` `chat:send` 는 `players.get(socket.id)` 가 없으면 `return` — 로그도 클라이언트 통지도 없다. 같은 가드가 `player:move`·NPC 대화 경로에도 있다면 그쪽도 함께 죽는다(미확인).
  - **Blast radius:** 재연결이 일어나는 모든 경우 — 네트워크 흔들림, 서버 재배포(`deploy:test` 직후 열려 있던 탭 전부), 같은 계정 두 탭의 kick 핑퐁. 헤더의 "AI 연결" 은 `socket.connected` 만 보므로 초록으로 남아 사용자가 원인을 알 길이 없다.
  - **Direction:** (1) 클라이언트: `connect` 핸들러에서 `socket.recovered` 가 아니면 마지막 `player:join` 페이로드(현재 좌표)로 재조인 — GameScene 이 마지막 조인 인자를 들고 있거나 GamePageClient 가 `player:join` 을 소유. (2) 서버: `players` 에 없는 소켓의 `chat:send` 는 조용히 리턴하지 말고 `chat:error {code:"not_joined"}` 를 그 소켓에 보내 클라이언트가 재조인을 트리거하거나 토스트를 띄운다. (1)+(2) 둘 다.
  - **Acceptance:** 서버가 소켓을 끊고(`io.sockets.sockets.get(id).disconnect()`) 클라이언트가 재연결한 뒤 `chat:send` 가 `chat:message` 로 에코된다. 소켓 핸들러 단위 테스트: `players` 에 없는 소켓의 `chat:send` 가 `chat:error` 를 돌려준다(조용한 리턴이면 빨강).
  - **Live evidence (해결 후, 2026-09-09 스테이징):** 페이지에서 `sock.io.engine.close()` 로 강제 재연결(id `T-o8k…` → `stkOq…`) → 클라이언트가 스스로 `player:join` 을 다시 보냈고(`emittedAfterClose: ["task:list","player:join"]`), 서버가 `players:state` 로 응답, 이어 보낸 `chat:send` 가 새로 고침 없이 `chat:message` 로 에코됐다. 별도 실행에서 플레이어 스폰 전(`playerReady=false`, 가려진 탭)에 보낸 `chat:send` 는 `chat:error {code:"not_joined"}` 를 받았다 — 서버 경로도 산 것을 확인. 구현: `src/game/socket-rejoin.ts`(연결 끊김 뒤 connect 에서 1회 재조인, `registerOnce` 로 리스너 멱등), `src/server/channel-chat.ts` `handleChatSend()`(not_joined 분기), `src/app/game/chat-error-dispatch.ts`(토스트 + `socket-rejoin`). 테스트 3+4+2 건.

## 회의실 실측에서 본 마찰 셋 (2026-09-09 · test.deskrpg.com live, 2026.9.9)

- [ ] **⏹ 종료가 진행 중인 NPC 턴이 끝날 때까지 반영되지 않는데 버튼에 아무 상태도 없다.** 클릭 후 8초 넘게 "자동 진행 중…" 이 그대로라 두 번 눌렀고, 두 번째 회의는 실제로 두 번 눌렀는지 알 수 없었다. `meeting:stop` 이 브로커 abort 를 기다리는 것이 의도라면 클릭 즉시 "종료 중…" 으로 바꾸고 버튼을 잠근다. **Acceptance:** 클릭 직후 버튼 상태 변경, `meeting:end` 수신 전 재클릭 무시.
- [ ] **회의록 보관함 패널을 열어 둔 채 회의가 끝나면 목록이 갱신되지 않는다.** 7턴 회의 종료 직후 `/api/meetings` 에는 새 회의록이 있었지만 보관함 목록엔 이전 2건만 보였다. `meeting:end` 에서 목록을 다시 불러오면 된다. **Acceptance:** 보관함이 열린 상태로 회의 종료 → 새 항목이 즉시 목록 최상단.
- [ ] **(코드 결함 아님 · 운영 메모) 올리버가 한국어 질문에도 영어로 답한다.** 본인 설명: 프로필 워크스페이스 `AGENTS.md` 의 언어 규칙이 영어를 요구. 회의 규약/채널 로케일이 프로필 지시를 못 이긴다는 뜻이므로, 회의 프롬프트에 채널 로케일을 "우선 규칙"으로 명시할지는 설계 판단. 지금은 MiniPC `~/.hermes/profiles/oliver/` 의 AGENTS.md 를 고치면 된다.

## `GameScene.setupSocketListeners()` 가 스폰마다 두 번 불려 소켓 리스너가 누적된다 (2026-09-09 · `fix/socket-rejoin` 최종 리뷰에서 확인)

- [ ] **`socket-ready` 가 정상 플로우에서 두 번 온다(`request-socket` 응답 + `player-spawned` 응답, `PhaserGame.tsx:109-111`). `handleSocketReady` 는 매번 `setupSocketListeners()` 를 통째로 다시 돌리므로 `players:state`·`player:joined`·`player:moved`·`player:left`·`npc:*` 리스너가 같은 소켓에 두 벌씩 붙는다. 이번 브랜치가 새로 넣은 세 리스너만 `registerOnce`/off→on 으로 멱등하게 했고 나머지는 그대로다.**
  - **Live evidence:** 최종 리뷰 `final-review.md` #8. 지금은 `addRemotePlayer` 의 `remotePlayers.has` 가드처럼 소비처 대부분이 멱등이라 증상이 가려져 있다.
  - **Root cause:** `src/game/scenes/GameScene.ts:2704-2816` — `this.socket.on(...)` 등록에 off 가 없다. `:1737` `handleSocketReady` 에 재호출 가드 없음.
  - **Blast radius:** 멱등하지 않은 소비처가 생기는 순간(카운터, 토스트, 애니메이션 트리거) 두 번 실행된다. 페이지 레벨 재연결로 새 소켓이 오면 옛 소켓 리스너는 사라지지만 같은 소켓에 대한 중복은 남는다.
  - **Direction:** (1) 모든 `this.socket.on` 을 필드 핸들러 + `registerOnce`(이미 있음)로 바꾸거나, (2) `setupSocketListeners` 가 `this.socket` 이 같은 인스턴스면 조기 반환(새 소켓이면 전체 재등록). (2) 가 작고 안전하다 — 단 SHUTDOWN 정리와 짝을 맞춘다.
  - **Acceptance:** `socket-ready` 를 같은 소켓으로 두 번 emit 해도 `socket.listeners("players:state").length === 1`. 순수 헬퍼 테스트 또는 fake socket 테스트로 고정.

- [ ] **토스트 id 가 고정 문자열이라 같은 토스트가 두 번 뜨면 React key 가 중복된다.** `showToastNotification("channel-chat-error", …)` 처럼 id 를 그대로 key 로 쓰는 기존 패턴(`socket-disconnected`, `channel-chat-disconnected` 도 동일). 중복 제거를 하든가 key 에 타임스탬프를 붙인다. `GamePageClient.tsx:447` `showToastNotification`.

## 그룹 대화방 — 스테이징 실측 (2026-09-10 · test.deskrpg.com live, 브랜치 `feat/chat-rooms` c217530a)

- [x] **스펙 `docs/superpowers/specs/2026-09-10-그룹-대화방-설계.md` 의 실측 체크리스트 8항목 중 7 통과, 1(재배포 후 잔존)은 아래 별도 확인. 실측 중 드러난 미해결 4건은 최종 리뷰 fix wave 로.**
  - **Live evidence:**
    1. 패널 열기 → 방이 office 하나라 바로 `사무실 전체`. `@[소피]` 지명 → 응답. 새로 고침 뒤 이력 그대로(`chat_room_messages` 2행, id 는 UUIDv7 `01a0875e-…-7…`).
    2. 출근부 `여러 명 선택` → 둘 체크 → `그룹 대화 시작` → 새 방 화면(둘 미리 체크) → 이름 "유튜브 기획" → 만들기 → 방 진입. 목록에 2개.
    3. 지명 없는 메시지 → **둘 다** 대답(소피 한국어, 올리버 영어), 둘 다 `calledForRoom` = 그 방, `visibleRoomId` 일치.
    4. 목록으로 나감 → `visibleRoomId=null`, 소피 즉시 `idle`(자리). 다시 들어가 메시지 → 소피 `waiting` 으로 재호출, 둘 다 다시 대답.
    5. NPC 우클릭 `그룹 대화로 초대`: 방 보이는 상태에서 이미 멤버 → 아무 변화 없음(dedupe, 조용함 — 아래 미해결). office 보이는 상태 → 새 방 화면에 그 NPC 미리 체크.
    6. (2 와 동일 경로로 확인)
    7. 재배포/신규 로드 후 잔존 ✅ (I-1 수정 f16f79f2 이후 실측: 새로 고침 → 사무실 방이 방 전환 없이 2행 그대로 렌더).
    8. DB: office 가 1개가 아닌 채널 0행 · `chat_rooms` office+group · 멤버 user 1 / npc 2 · 메시지 5.
  - **환경 함정:** 가려진 탭이라 Phaser 루프가 거의 안 돌아 올리버는 내내 `moving-to-player`(걷기 정지) — 코드 문제 아님.

- [ ] **방이 office 하나뿐일 때 패널의 `[+ 새 방]` 에 닿을 수 없다.** 목록을 건너뛰고 바로 office 로 들어가며, office 방의 `◀` 는 패널을 접는다. 출근부/우클릭 경로는 되지만 패널 자체의 진입점이 죽어 있다.
  - **Direction:** 방 헤더에 `[+ 새 방]` 을 항상 두거나(`RoomHeader`), office 만 있어도 `◀` 가 목록을 보이게.
- [ ] **방이 둘 이상이면 패널을 접을 수 없다.** 방 `◀` → 목록, 목록 `◀` → 방으로 되돌아온다. 접는 컨트롤이 없다.
  - **Root cause:** `ChatPanel.tsx` 목록 뷰의 `◀` 가 "이전 화면(방)" 으로 구현됨. 스펙 ③ "한 단계 위" 의 목록 위는 "닫힘" 이어야 한다.
  - **Acceptance:** 목록에서 `◀` → `setManualOpen(false)`. 컴포넌트 테스트.
- [ ] **이미 멤버인 NPC 를 우클릭 초대하면 아무 반응이 없다.** 서버 dedupe 는 옳지만 사용자는 클릭이 먹었는지 모른다.
  - **Direction:** 컨텍스트 메뉴에서 현재 방 멤버는 항목을 비활성(또는 "이미 참여 중") 으로, 혹은 `room:updated` 대신 토스트 `room.alreadyMember`.
- [ ] **새 방/초대 화면의 사람 후보에 나 자신이 있다.** `onlinePlayers` 에 본인이 포함돼 "단테 · 접속 중" 이 체크박스로 뜬다. 만든 사람은 자동 멤버이므로 후보에서 빼야 한다(`viewerUserId` 로 거르면 됨).

## 다음 사이클 — Hermes 칸반·크론 통합 후속 (2026-09-14 · dryforge 사이클 1 마무리에서 등록)

- [ ] **`deskrpg-hermes-plugin` 0.6.0 — 칸반·크론·사건 라우트 구현.** DeskRPG 쪽은 `.dryforge/001/spec.md` 부록 A 계약을 가짜 서버로 고정해 두었다. 플러그인이 그 계약을 제공하기 전에는 칸반·크론 화면이 "플러그인 업데이트 필요" 로만 보인다.
  - **Direction:** 대시보드 칸반 플러그인(`plugins/kanban/dashboard/plugin_api.py`)·`hermes_cli/web_routers/cron.py` 재사용. `approve / request-changes / unblock / archive / terminate(태스크 단위)` 는 대시보드에 없어 `kanban_db` 위에 새로 만든다. 통합 사건 커서(`/deskrpg/events`)와 크론 `run.started/finished` 사건 합성이 핵심.
- [ ] **스웜 생성 UI.** `hermes kanban swarm` 토폴로지(루트→워커→검증→종합)를 `POST /tasks` + `POST /links` 로 재현하는 화면. 관측(의존 링크·진행률)은 이미 보드에 있다.
- [ ] **플러그인 → DeskRPG 푸시 알림.** 폴링 지연이 거슬리면 `POST /api/internal/automation/push` 같은 수신 라우트가 같은 `ingest()` 를 부르게 한다(사건 싱크는 이미 단일 진입점).
- [ ] **첨부 파일 바이트 다운로드.** 현재 `GET /kanban/attachments/:id` 는 메타데이터만 전달한다(플러그인 클라이언트가 JSON 전용). 바이너리 스트리밍은 클라이언트 확장 필요.
- [ ] **`automation-poller.test.ts` 타이머 레지스트리 테스트가 간헐적으로 실패한다**(벽시계 타이머, 약 1/3 확률로 단독 실행 시 실패 — T9 작업자 관측). 가짜 타이머로 바꾸거나 여유를 준다.
- [ ] **`src/proxy.ts` 가 들어오는 요청의 `x-user-id`/`x-user-nickname` 을 먼저 지우지 않는다**(자동 보안 점검 지적). 공개 경로·미인증 경로에서도 헤더를 벗겨낸 뒤 JWT 검증 후에만 붙이도록 바꾼다. 칸반·크론 REST 가 같은 헤더를 신뢰한다.

---

## 설치·초기 세팅 UX 과제 8건 (2026-09-15 · 실제 호스트 검증에서 관찰)

MiniPC 에 전용 계정을 만들어 Hermes 를 처음부터 설치하며(그리고 이 맥의 실제 설치를 읽기 전용으로
훑으며) 관찰한 것만 올린다. 각 항목의 근거는 그 자리에서 찍은 명령·출력이다.
순서는 합의된 진행 순서다(큰 것 셋 → 중간 셋 → 작은 둘).

### 큰 것

- [ ] **설치를 마쳐도 모델 로그인이 안 돼 있으면 직원이 한마디도 못 하는데, 마법사는 경고만 남기고 끝난다.**
  - **Live evidence:** 신규 설치 직후 `verify` 가 `warnings: []` 로 통과했다. 제공자가 하나도
    없는데도 `/v1/models` 가 `status=200`, 모델 1개를 돌려준다(실측) — 원래 쓰려던 "목록이 비었는가"
    신호는 한 번도 뜨지 않는다. 지금은 `collectSetupWarnings` 가 "방금 설치했다" 로 대신 판정한다.
  - **Root cause:** 자격 증명 유무를 보는 신호가 없다. `src/lib/hermes/setup/policy.ts` 의
    `collectSetupWarnings` 는 설치 여부만 안다.
  - **Blast radius:** 처음 설치하는 모든 사용자. 증상은 "직원이 대답을 안 함" 이라 원인을 못 찾는다.
  - **Direction:** ① 마법사 마지막에 "모델 확인" 단계를 두고 `hermes auth status <provider>` 의
    한 줄 결과를 읽는다(실측: `openai-codex: logged in`). ② 확인 실패면 실패가 아니라 경고로,
    터미널에서 `hermes model` 을 실행하라고 안내하고 다시 확인 버튼을 준다. ③ 키를 직접 받는
    제공자까지 폼에서 받을지는 별도 결정 — 남의 모델 키를 웹이 다루는 범위 확장이다.
  - **Acceptance:** 자격 증명이 없는 호스트에서 마법사가 경고를 띄우고, 사용자가 터미널에서
    로그인한 뒤 확인을 누르면 경고가 사라진다. 순수 함수로 분리해 테스트로 고정한다.

- [ ] **설치가 3~6분 걸리는데 화면에는 단계 이름 하나뿐이라 멈춘 것처럼 보인다.**
  - **Live evidence:** MiniPC 신규 계정 설치가 약 5분, `~/.hermes` 가 176K → 1.3G 로 커지는 동안
    잡의 단계는 `installing_hermes` 하나로 고정.
  - **Root cause:** `HOST_INSTALLER` 가 설치 출력을 읽고 버린다(`host-helper.ts`, 꼬리 8KiB 만 유지).
    진행을 알릴 통로가 없다.
  - **Blast radius:** 노트북·VPS 처음 설치하는 모든 사용자. 취소 버튼을 누르게 만든다.
  - **Direction:** 출력을 저장하지 않는다는 원칙은 지키되, 줄을 흘려보며 알려진 이정표
    (노드 내려받기·저장소 복제·의존성 설치·브라우저 건너뜀)만 뽑아 잡의 하위 진행으로 올린다.
    원문은 여전히 저장·반환하지 않는다.
  - **Acceptance:** 설치 중 화면의 문구가 최소 세 번 바뀐다. 출력 원문이 잡 파일·응답 어디에도 없다.

- [ ] **중간에 실패하면 처음부터 다시 한다 — 재개도 롤백도 없다.**
  - **Live evidence:** `src/lib/hermes/setup/service.ts` 에 resume 경로가 없다(grep 0건).
    실패 경로는 status/error 만 기록한다. 설치·유닛·설정은 그대로 남는다.
  - **Blast radius:** 네트워크가 한 번 끊긴 사용자. 1.3GB 를 다시 받는다.
  - **Direction:** 잡에 남는 단계 기록을 근거로 이미 끝난 단계를 건너뛴다. 롤백은 여전히 하지
    않되(문서에 명시된 정책), "어디까지 됐는지" 를 화면이 보여 주고 이어서 실행한다.
  - **Acceptance:** 설치가 끝난 뒤 플러그인 단계에서 실패시킨 잡을 다시 돌리면 설치를 건너뛴다.

### 중간

- [ ] **포트가 이미 쓰이면 사람이 설정 파일을 열어 포트를 옮겨야 한다.**
  - **Live evidence:** 신규 계정 inspect 가 `{"error": "port_conflict"}` — 같은 머신의 다른
    Hermes 가 8642 를 소유. `.env` 에 `API_SERVER_PORT=8742` 를 직접 넣고서야 진행됐다.
  - **Root cause:** 마법사는 포트를 읽기만 한다(`host-helper.ts` 의 settings, HOST/PORT 미설정).
  - **Blast radius:** 노트북에서 프로필을 여럿 쓰는 사용자. 이 맥은 프로필 15개 중 다수가 8642 를 가리킨다.
  - **Direction:** 충돌을 감지하면 빈 포트를 제안하고(범위 고정), 동의를 받아 그 프로필의 `.env` 에만 쓴다.
    남의 리스너는 여전히 건드리지 않는다.
  - **Acceptance:** 8642 가 남의 것일 때 마법사가 대안 포트를 제안하고, 수락하면 그 프로필로 검증까지 간다.

- [ ] **첫 대화까지 화면을 여섯 번 건넌다.**
  - **Live evidence:** 가입 → `/gateways`(강제) → 캐릭터 → 채널 → 게임 화면 배치 → 대화.
    고용 마법사는 `/gateways`, 자리 배치는 게임 화면으로 갈린다(`NpcHireWizard` 주석이 그렇게 설명).
  - **Direction:** "빠른 시작" 하나로 기본 캐릭터·채널을 만들고 첫 프로필을 자리까지 앉힌다.
    각 단계는 그대로 두고 지름길만 더한다.
  - **Acceptance:** 새 계정이 버튼 한 번으로 대화 가능한 상태에 도달한다.

- [ ] **웹에 진단 화면이 없다.**
  - **Live evidence:** `deskrpg doctor` 는 CLI 전용. 브라우저에서 환경·DB·포트·게이트웨이 상태를 볼 길이 없다.
  - **Direction:** 관리자에게만 보이는 진단 화면에서 같은 검사를 돌려 보여 준다. 비밀 값은 길이만.
  - **Acceptance:** 관리자가 브라우저에서 doctor 와 같은 항목을 본다. 비관리자는 404.

### 작은 것

- [ ] **명령을 보여 주는 자리마다 복사 버튼이 없다.** (`clipboard` grep 0건)
  - 플러그인 설치 명령, 호스트 설정 명령, 모델 로그인 명령 세 곳.
- [ ] **가입 화면이 "첫 계정이 곧 관리자" 라는 사실을 충분히 알리지 않는다.**
  - `auth.setupDescription` 이 "관리자 계정을 만들어 시작하세요" 한 줄뿐이다. 공개 서버에 올린
    사람에게는 가입을 언제 닫아야 하는지가 중요한 정보다.
