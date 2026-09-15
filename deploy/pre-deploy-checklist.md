# Pre-deploy Checklist

이 문서는 배포 전 점검 항목입니다. 배포 전에 자동화 가능한 항목은
`npm run tc pre-deploy`로 실행하고, 나머지는 문서 항목을 수동으로 확인합니다.

문서가 배포 이미지에는 포함되지 않도록 `.gitignore`로 관리합니다.

## 1) 배포 직전 자동 체크 (`npm run tc pre-deploy`)

스크립트가 통과해야 할 항목:

- `master` 브랜치에서 실행 중인지 확인
- Git 작업트리가 깨끗한지 확인 (`git status` no changes)
- `docker compose -f docker-compose.yml --env-file .env.production config` 실행 가능
- `JWT_SECRET`, `POSTGRES_PASSWORD`가 `.env.production`에 비어있지 않게 존재
- 배포용 Docker 이미지가 정상적으로 pull 가능한지 검증 (`docker pull ${DESKRPG_IMAGE:-dandacompany/deskrpg:latest}`)

## 2) 배포 스크립트 수동 체크 항목

- 배포 PR/요청 본문에 `deploy/pre-deploy-checklist.md` 결과 요약 반영
- 변경 건수가 `master`에 반영되었는지, 태그/버전 정보가 `package.json`과 일치하는지 확인
- `JWT_SECRET` / `POSTGRES_PASSWORD` 운영값과 일치하는지 확인
- OpenClaw/Provider 연동이 필요한 경우:
  - `OPENCLAW_TOKEN`, `OPENCLAW_MODEL`, `OPENCLAW_URL` 값 확인
  - 대시보드에서 페어링/온보딩 상태 점검
- Hermes 프로필 연동이 필요한 경우:
  - Hermes 게이트웨이에 `multiplex_profiles`가 활성화되어 있고, `api_server` 플랫폼으로 설정되어 있는지 확인
  - 각 프로필이 16자 이상의 자체 `API_SERVER_KEY`를 보유하는지 확인 (프로필 간 키 공유 금지)
  - 각 프로필이 `Authorization: Bearer <API_SERVER_KEY>` 헤더로 `/p/<name>/v1/capabilities` 경로에서 정상 응답하는지 확인 (앱이 실제로 검증에 쓰는 엔드포인트 — `/health`는 인증 없이도 200을 줄 수 있어 프로필 스코프 키 문제를 잡지 못함)
- 칸반·크론(자동화) 기능을 쓰는 경우:
  - 게이트웨이에 `deskrpg-hermes-plugin` **0.6.0 이상**이 설치·enable 되어 있는지 확인 (`hermes plugins doctor deskrpg`, 게이트웨이 재시작 후 `GET /deskrpg/info` 의 `version`·`capabilities` 에 kanban·cron·events 포함)
  - 스테이징에서 카드 하나가 실제 실행되고 완료 알림이 사무실 방에 오르는지, 크론 하나를 "지금 실행"해 결과가 방에 게시되는지 사람이 확인 (`e2e/README.md` 의 수동 확인 절차)
- 배포 후 초기 접근 경로 점검(`/auth` 리다이렉트 또는 대체 헬스체크)

## 3) 선택: 배포용 Smoke 테스트 (`tc` 플래그)

- `npm run tc pre-deploy -- --smoke` 실행 시 컨테이너 기동 후 응답 확인까지 수행
- 스모크 테스트는 실패 시 종료 코드와 로그를 확인하고 즉시 롤백 계획을 준비

## 4) 릴리스 전용이 아닌 별도 테스트 배포

릴리스 전 수정 검증이 필요할 때는 운영 브랜치/태그와 무관하게 다음으로 별도 테스트 배포를 수행한다:

- `npm run tc test-deploy -- --build --image deskrpg:tc`
- `--build`: 현재 체크아웃한 커밋 기준으로 로컬 이미지를 빌드
- `--image`: 테스트에 사용할 이미지 태그 지정 (기본값 `dandacompany/deskrpg:latest`)
- `--keep`: 테스트 완료 후 컨테이너를 종료하지 않고 유지(원하면)

테스트 배포는 기본적으로 다음 포트를 사용한다:

- 앱: `3104` (`/` 응답 200/307 체크)
- 관리 포트: `3105`
- DB: `5439`

`docker-compose.test.yml`을 사용해 운영 배포의 `latest` 태깅이나 `master` 브랜치 조건 없이 실행한다.

## 5) 승인

- 자동화 체크와 수동 체크 모두 통과 후 배포 승인

## 6) Creative studio / exact agency migration gate

- [ ] Record the verified commit and test/typecheck/lint/build logs. Run `src/lib/creative-studio-package.test.ts` plus Docker source-dependency checks. Inventory npm for the complete shared Three runtime, every catalog URL, surface maps, all 40 generated studio GLBs, three new build reports and `agency-v3.webp`; retain character/spritesheet and legacy assets.
- [ ] Apply `docs/design/three-asset-quality-checklist.md`: measured GLB bounds (0.001m tolerance), exact report bytes/triangles, source/license/fallback/material metadata, 512–1024px ordinary / up to 2048px hero maps, sRGB base color and linear normals/roughness, seamless UV scale.
- [ ] Capture 1748×900/DPR1 overview and photo, production, both lounges, meeting, pantry, brick/window seams, glass corners and plant leaves. Check cutaway/highest-object bounds, seated intersections, transparency, contact shadows, normal detail and palette. Record reference-coordinate/density or pantry/rug/shadow limitations explicitly.
- [ ] Capture matching reflection on/off views: faint broad floor/window sheen; glass/metal reflections; diffuse fabric/brick. The local 128px probe is static/approximate. PCF shadows must remain soft and glazing must not cast opaque shadows.
- [ ] At overview and orbit/walk maxima: ≤1.2M triangles, ≤350 draws and <25MB compressed agency/new-shared transfer. Staging reference Chrome/Comet: 10s warmup + 30s orbit/walk, 10 NPC + 2 players with labels/speech, median ≥55FPS and p95 <25ms. Record raw samples, GPU/backend, browser, viewport/DPR and sample count; software/local timing is not staging acceptance.
- [ ] Follow `docs/creative-studio-staging-preparation.md`: quiesce staging; retain a private full PostgreSQL archive covering every eligible channel; restore-test it in a disposable DB; copy both preservation and bootstrap-check SQL files separately; record `before-schema.json` with version counts and the all-channel map hash. Never use `down -v` on the existing staging DB.
- [ ] Schema-only phase: deploy/start new code with `DESKRPG_MAP_BACKUP_DIR` unset/empty (fail closed), verify the effective app environment without printing secrets, then stop/quiesce the app. Run `creative-studio-bootstrap-check.sql` into `after-schema.json`: 0011 columns/tables present, 0012 retired tables absent, every map hash/version count unchanged. Retain the pre-schema archive for retired task data.
- [ ] With schema complete and app stopped, run `creative-studio-preservation.sql` into the quiet **post-schema/pre-map** `before.ndjson`. Never use pre-deployment whole-row hashes across added columns. Only after this baseline may map upgrades be enabled.
- [ ] Mount a durable 0700 host directory outside the rsync build context, configure `DESKRPG_MAP_BACKUP_DIR` in the staging app/Next process and verify UID 1001 write/fsync/rename, 0600 backup files and mount persistence across recreation. Restart the same image with the new configuration; keep browser and background writes quiet. Exactly one socket authority; missing/unwritable storage leaves old v2 unchanged.
- [ ] Two-browser exact-v3 upgrade plus exact-v2 database-path probe: begin/ready refresh, 42×26/version 4, sanitized live positions and cleared reservations/continuations. Edited v2/v3 maps remain unchanged/legacy. Keep sessions idle until the quiet preservation comparison passes.
- [ ] Before unrelated activity resumes, compare all before/after counts/hashes: channel ID/members, users, profiles/NPC assignments and stored homes, characters, groups/group members, rooms/room members, both room messages and NPC chat history, actual gateway bindings/shares/config and other non-map fields unchanged. Only an opened exact map and its `updated_at` change. Record backup filenames/hashes, never raw maps, credentials or chat content.
- [ ] After the quiet comparison passes: missing/stale revision fails and fresh bootstrap succeeds. Take separate `before-rename.ndjson` / `after-rename.ndjson` snapshots; the admitted client emits NPC updates before and after rename with the same map revision. Only the renamed channel metadata hash/timestamp may change in this separate comparison. Then verify real map replacement invalidates the old revision.
- [ ] Authenticated staging: orbit/pan/zoom, walking, fixed-seat departure/return, temporary seating, simultaneous NPC walkers, refresh persistence and channel re-entry. Executive/publishing/trading/tech retain dimensions, seats, room policy and assets.
- [ ] Push/deploy remain controller actions. Promote the reviewed commit to clean `master` before `tc pre-deploy`; do not bypass its branch/clean-tree gate or create a production tag/release.
