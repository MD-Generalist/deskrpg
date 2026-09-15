/**
 * `@/...` 경로 별칭을 런타임에 해석한다.
 *
 * tsx 는 tsconfig 의 `paths` 로 이 별칭을 풀어 주지만, **`node_modules` 안에 있는 파일에는
 * 그 매핑을 적용하지 않는다**(리졸버의 표준 동작). `npm i -g deskrpg` 로 깔면 서버 소스가
 * `.../node_modules/deskrpg/src/**` 에 놓이므로, 소켓 서버가 처음 `@/db` 를 부르는 순간
 * `Cannot find module '@/db'` 로 죽는다.
 *
 * 실측(2026-09-15): 배포본 2026.9.18·2026.9.19 모두 `deskrpg start` 가 이 오류로 기동하지
 * 못했다. 같은 파일 묶음을 `node_modules` 밖으로 옮기면 그대로 떴다 — 코드가 아니라 설치
 * 위치의 문제다. Docker 이미지는 `/app` 에 풀리므로 영향이 없었고, 그래서 이 결함이
 * npm 경로에서만 조용히 살아 있었다.
 *
 * 그래서 해석을 우리가 직접 한다. `@/` 로 시작하는 요청만 패키지의 `src/` 로 돌리고,
 * 나머지는 손대지 않는다.
 */
const Module = require("node:module");
const path = require("node:path");

const PREFIX = "@/";

function installPathAlias(rootDir) {
  const srcDir = path.join(rootDir, "src");
  const original = Module._resolveFilename;
  if (original.__deskrpgAlias) return;

  function resolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith(PREFIX)) {
      const mapped = path.join(srcDir, request.slice(PREFIX.length));
      try {
        return original.call(this, mapped, parent, isMain, options);
      } catch {
        // 매핑이 실패하면 원래 요청 그대로 흘려보낸다 — 우리가 새 오류를 만들지 않는다.
      }
    }
    return original.call(this, request, parent, isMain, options);
  }

  resolveFilename.__deskrpgAlias = true;
  Module._resolveFilename = resolveFilename;
}

module.exports = { installPathAlias };
