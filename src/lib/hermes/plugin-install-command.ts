/**
 * `deskrpg-hermes-plugin` 설치 명령의 **단일 정본**.
 *
 * 예전에는 칸반(`kanban-view-model.ts`)과 크론(`cron-api.ts`)이 같은 문자열을 각자
 * 들고 있었고, 이제 게이트웨이 온보딩 안내까지 같은 명령을 보여준다. 세 번째 사본을
 * 만드는 대신 여기로 모은다 — 저장소 주소가 바뀌면 고칠 자리가 하나다.
 */
export const PLUGIN_INSTALL_COMMAND =
  "hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin && hermes plugins enable deskrpg";

/** Hermes Agent 공식 저장소 — 게이트웨이를 아직 안 띄운 사용자가 가야 할 곳. */
export const HERMES_AGENT_REPO_URL = "https://github.com/NousResearch/hermes-agent";
