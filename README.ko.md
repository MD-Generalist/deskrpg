# DeskRPG

English README: [README.md](README.md)

<img src="public/readme/home-screenshot.png" alt="DeskRPG 홈 화면" width="100%" />

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/dandacompany/deskrpg/refs/tags/2026.9.18/deploy/hostinger/docker-compose.yml)

오피스와 Hermes Agent를 VPS 한 대에서 24시간 돌리는 방법은 [deploy/hostinger](deploy/hostinger/README.md)를 보세요.

DeskRPG는 직접 호스팅하는 **AI 에이전트용 3D 미니어처 가상 오피스**입니다. 이미 쓰고 있는 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 프로필이 그대로 직원이 됩니다. 자리에 앉아 있다가 지명하면 답하고, 회의실에서 발언권을 주고받고, 칸반 카드를 처리하고, 일이 끝나면 **걸어와서 보고합니다**. 여러 사람이 같은 오피스에 동시에 들어올 수 있습니다.

DeskRPG는 에이전트 런타임을 따로 담고 있지 않습니다. 이미 돌리고 있는 Hermes 게이트웨이에 붙기만 하므로, 기존 Hermes 사용자는 옮길 것 없이 프로필 그대로 올라탑니다.

- 웹사이트: `https://deskrpg.com` (준비 중)
- 소스 코드: `https://github.com/dandacompany/deskrpg`
- 버전: `v2026.9.18` — 아침 출근길의 차량·나무·재질과 보폭에 맞춘 이동을 개선했습니다 (2D 픽셀아트 클라이언트는 `2026.9.9` 이하 태그에서 받을 수 있습니다)

## 무엇을 할 수 있나요

- 나와 모든 NPC의 외형을 50종의 스타일화된 오피스 룩(CC0 Quaternius 베이스를 완성형 인물로 재제작) 중에서 고릅니다. 룩 하나가 GLB 하나이고, 맵·출근부·회의실이 같은 모델을 씁니다.
- three.js로 그린 3D 오피스를 다섯 가지 환경(종합상사·에이전시·테크 스타트업·임원실·출판사)에서 걸어 다닙니다. 이동·좌석·충돌은 기존 Phaser 시뮬레이션이 계속 맡고, three.js는 그리기만 합니다.
- Hermes 게이트웨이를 주소로 등록하거나, 설정 마법사로 로컬·SSH로 닿는 Hermes 설치를 찾아 플러그인을 점검하고 프로필을 등록합니다.
- Hermes 프로필에 묶인 AI NPC를 고용하고, `SOUL.md`를 웹에서 편집하고, NPC마다 모델·프로바이더·툴셋·추론 강도를 정합니다.
- 오피스 방에서 지명해 대화하고, NPC를 초대한 그룹 방을 열고, 6단계 응답 리시트(대기 → 생각 중 → 스트리밍 → 완료)와 에이전트가 지금 쓰는 도구를 봅니다.
- 전용 회의실에서 발언권 제어·거수·회의록 내보내기가 있는 회의를 엽니다.
- 칸반 카드를 백로그 → 대기 → 진행 중 → 정체 → 완료로 옮기고, 정체된 일을 독촉·재개하고, 보고는 오피스 안에서 받습니다. NPC가 걸어옵니다.
- 다른 사람과 오피스를 공유합니다(멀티플레이어, 그룹, 역할 기반 권한). 한국어·영어·일본어·중국어를 지원합니다.
- 브라우저 맵 에디터로 오피스 맵을 직접 만들거나 올립니다.

## 스크린샷

<table width="100%">
  <tr>
    <td width="50%" valign="top"><img src="public/readme/deskrpg-login-to-office.gif" alt="DeskRPG 접속하기" width="100%" /></td>
    <td width="50%" valign="top"><img src="public/readme/deskrpg-npc-task-loop.gif" alt="DeskRPG NPC 채팅과 태스크" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" align="center"><strong>접속하기</strong></td>
    <td width="50%" align="center"><strong>NPC 채팅과 태스크</strong></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img src="public/readme/deskrpg-meeting-room.gif" alt="DeskRPG 회의실" width="100%" /></td>
    <td width="50%" valign="top"><img src="public/readme/deskrpg-map-editor.gif" alt="DeskRPG 맵 에디터" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" align="center"><strong>회의실</strong></td>
    <td width="50%" align="center"><strong>맵 에디터</strong></td>
  </tr>
</table>

## 빠른 시작

아래 다섯 가지 방법 중 하나를 골라 DeskRPG를 시작할 수 있습니다.

### 1. npm 설치 런타임

레포를 클론하지 않고 설치형 앱처럼 바로 쓰고 싶다면 이 방식이 가장 간단합니다.

```bash
npx deskrpg init
npx deskrpg start
```

DeskRPG의 가변 런타임 데이터는 `~/.deskrpg/` 아래에 저장됩니다.

- `~/.deskrpg/.env.local`
- `~/.deskrpg/data/deskrpg.db`
- `~/.deskrpg/uploads/`
- `~/.deskrpg/logs/`

브라우저에서 `http://localhost:3000`을 엽니다.

퍼블리시된 npm 패키지 이름은 `deskrpg`입니다.

### 2. 로컬 실행 + PostgreSQL

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
cp .env.example .env.local
npm run setup
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

레포에서 전체 기능을 가장 직접적으로 확인하려면 이 방식이 가장 좋습니다.

### 3. 로컬 실행 + SQLite

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
npm run setup:lite
npm run dev
```

SQLite 데이터는 `data/deskrpg.db`에 저장됩니다.

### 4. Docker + PostgreSQL

여러 사용자가 함께 쓰거나, 조금 더 안정적인 데이터 저장이 필요하면 이 구성을 권장합니다.

```bash
cp .env.example .env.docker
docker compose --env-file .env.docker up -d
```

처음 실행하기 전 `.env.docker`를 열어 아래 값을 설정하세요.

- `JWT_SECRET`
- `POSTGRES_PASSWORD`

DeskRPG는 `http://localhost:3102`에서 열립니다.

기본 이미지는 `dandacompany/deskrpg:latest`입니다.
특정 릴리스를 고정하고 싶다면 `.env.docker`의 `DESKRPG_IMAGE`를 `dandacompany/deskrpg:2026.4.6`처럼 바꾸면 됩니다.

명시적으로 파일 경로를 지정하고 싶다면 아래 명령을 사용해도 됩니다.

```bash
docker compose --env-file .env.docker -f docker/docker-compose.external.yml up -d
```

### 5. Docker + SQLite

한 대의 서버에서 가볍게 시작하고 싶다면 이 구성이 가장 간단합니다.

```bash
JWT_SECRET=change-me docker compose -f docker/docker-compose.lite.yml up -d
```

DeskRPG는 `http://localhost:3102`에서 열립니다.

특정 이미지 버전을 쓰고 싶다면 명령 앞에 `DESKRPG_IMAGE=dandacompany/deskrpg:2026.4.6`을 붙이면 됩니다.

빠르게 시작하려면 SQLite, 오래 운영하려면 PostgreSQL을 선택하면 됩니다.

### 환경 변수

중요한 환경 변수:

- `JWT_SECRET`
- `POSTGRES_PASSWORD` (PostgreSQL Docker 구성 사용 시)
- `DESKRPG_LOCAL_DISCOVERY_ENABLED` (선택 사항. 루프백 게이트웨이가 호스트의 `~/.hermes/profiles`를 읽도록 허용합니다. 기본값은 꺼짐)
- `DESKRPG_HOST_SETUP_ENABLED` (선택 사항. `system_admin` 에게 로컬·SSH 게이트웨이 설정 마법사를 엽니다. 기본값은 꺼짐)

운영 환경에서는 반드시 실제 `JWT_SECRET` 값을 설정해야 합니다.

게이트웨이 URL과 토큰은 환경 변수가 아닙니다. 앱의 `내 게이트웨이` 페이지에서 등록한 뒤,
`설정 -> 채널 설정 -> AI 연결`에서 채널에 연결합니다.

## Hermes 연결

AI NPC, 태스크 자동화, AI 회의는 모두 Hermes 게이트웨이를 통해 동작합니다.

DeskRPG는 에이전트 런타임을 함께 배포하지 않습니다.
[Hermes Agent](https://github.com/NousResearch/hermes-agent) API 서버를 직접 띄우세요.
같은 머신이든 접근 가능한 다른 호스트든 상관없습니다. Hermes 쪽에서 두 가지를 확인해 둡니다.

- API 서버가 열려 있는 주소 (예: `http://127.0.0.1:8642`)
- **리스너 소유자 키** — 리스너를 소유한 프로필의 `API_SERVER_KEY`

Hermes는 설정이 머신 단위인 반면 인증은 프로필 단위입니다. 프로필마다 키가 따로 있습니다.
DeskRPG에는 보조 프로필의 키가 아니라 **소유자 키**를 주세요. 칸반·크론·사건 스트림은
프리픽스 없는 경로에 있고, Hermes는 그 경로를 소유자 키로만 인증합니다. 보조 프로필의 키로도
대화는 되지만 보드와 일정은 전부 `plugin_unauthorized` 로 막히고 화면은 이유를 알려주지 않습니다.

DeskRPG에 연결하는 절차는 네 단계입니다.

**1. 게이트웨이 등록**

우측 상단 메뉴에서 `내 게이트웨이`를 열고 `새 게이트웨이`를 선택합니다.

- `표시 이름` — 나중에 알아볼 수 있는 이름이면 됩니다
- `Hermes 게이트웨이 URL` — 예: `http://127.0.0.1:8642`
- `토큰` — 해당 게이트웨이의 리스너 소유자 키(`API_SERVER_KEY`)

저장한 뒤 연결 테스트를 실행합니다. 실패하면 그냥 실패로 끝나지 않고 원인을 알려주므로,
설정을 바꾸기 전에 메시지를 먼저 읽어 보세요.

**2. Hermes 프로필 추가**

하나의 게이트웨이가 여러 에이전트 프로필을 서빙할 수 있고, 프로필마다 키가 다릅니다.
같은 페이지에서 추가합니다. NPC가 실제로 바인딩되는 대상은 프로필이므로, 게이트웨이만
등록해 두면 아직 부족합니다.

**3. 채널에 게이트웨이 연결**

채널에 입장한 뒤 `설정 -> 채널 설정 -> AI 연결`에서 저장해 둔 게이트웨이를 고르고,
테스트한 다음 저장합니다. 적용되면 헤더 배지가 `AI 연결`로 바뀝니다.

**4. 칸반·크론을 쓰려면 플러그인 설치**

대화는 플러그인 없이도 됩니다. 칸반 보드와 사건 스트림, 크론은 게이트웨이 호스트에
[`deskrpg-hermes-plugin`](https://github.com/dandacompany/deskrpg-hermes-plugin) 이 필요합니다.

```bash
hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin
hermes plugins enable deskrpg
# 게이트웨이 재시작 — 라우트는 기동할 때만 붙습니다
```

`enable` 은 선택이 아닙니다. 설치만 하고 건너뛰면 모든 플러그인 라우트가 404를 냅니다.
DeskRPG는 플러그인이 없거나 낡았다고 판단하면 보드·일정 화면에 같은 명령을 그대로 보여줍니다.

이제 NPC를 고용할 수 있습니다. NPC는 고용 시점에 Hermes 프로필 하나에 바인딩되며,
해고하지 않고 나중에 다른 프로필로 다시 연결할 수 있습니다.

## DeskRPG는 어떻게 동작하나요

### 1. 캐릭터

- 모든 사용자는 캐릭터로 채널에 입장합니다.
- 캐릭터 외형은 LPC 레이어 스프라이트를 조합해 구성됩니다.
- 채널에 들어가기 전에 캐릭터를 먼저 만들어야 합니다.

### 2. 채널

- 채널은 공유 오피스 공간입니다.
- 공개/비공개 여부와 그룹 규칙에 따라 접근 방식이 달라질 수 있습니다.
- 채널 맵은 맵 템플릿을 기반으로 생성됩니다.

### 3. AI NPC

- NPC는 채널 안에서 함께 생활합니다.
- NPC는 Hermes 프로필 하나에 바인딩되며, 해고하지 않고 다시 연결할 수 있습니다.
- NPC와의 1:1 대화는 캐릭터별로 저장되어 서버를 재시작해도 남습니다.
- 앱 안의 메뉴에서 호출, 복귀, 대화, 수정, 대화 초기화, 해고가 가능합니다.

### 4. 태스크

- NPC와의 대화를 통해 업무를 맡길 수 있습니다.
- 태스크는 `대기`, `진행중`, `중단`, `완료` 상태를 오갑니다.
- 자동 재촉과 수동 보고 요청으로 NPC의 진행을 계속 밀어줄 수 있습니다.
- 중요한 보고는 NPC가 직접 플레이어에게 걸어와 전달합니다.

### 5. 회의

- DeskRPG에는 전용 회의실이 있습니다.
- AI 회의는 채널 단위로 동작하며, 해당 채널의 Hermes 게이트웨이가 오케스트레이션합니다.
- 저장된 회의록은 헤더에서 바로 확인할 수 있습니다.

### 6. 맵 에디터

- 브라우저 기반 맵 에디터는 Tiled 스타일 워크플로를 지원합니다.
- 맵 템플릿 업로드, 프로젝트 연결 자산 관리, 채널용 맵 재사용이 가능합니다.
- 별도 부속 도구가 아니라 DeskRPG의 주요 서브시스템입니다.

## 제품 메모

- 초대 코드가 있어도 로그인은 필요합니다.
- 초대 코드는 채널 접근을 돕는 수단이지, 익명 접근 토큰은 아닙니다.
- 기본 오피스 타일과 오브젝트 텍스처는 런타임에 코드로 생성됩니다.
- LPC 아바타 스프라이트는 별도 크레딧과 라이선스 문서를 따릅니다.

## 라이선스와 크레딧

- 프로젝트 라이선스: [LICENSE.md](LICENSE.md)
- 서드파티 라이선스: [public/third-party-licenses.html](public/third-party-licenses.html)
- LPC 아바타 크레딧: [public/assets/spritesheets/CREDITS.md](public/assets/spritesheets/CREDITS.md)
- LPC 아바타 라이선스 안내: [public/assets/spritesheets/LICENSE-assets.md](public/assets/spritesheets/LICENSE-assets.md)
- LPC 전체 크레딧 데이터: [public/assets/spritesheets/CREDITS.csv](public/assets/spritesheets/CREDITS.csv)

## 문의

- YouTube: [@dante-labs](https://youtube.com/@dante-labs)
- 이메일: `dante@dante-labs.com`
- Buy Me a Coffee: `https://buymeacoffee.com/dante.labs`
