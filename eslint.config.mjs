import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 오래된 클로저가 조용히 값을 떨구는 결함을 실제로 겪었다 — 위저드가
  // "저장했습니다" 를 띄우면서 reasoning_effort 를 안 보냈다(catalog 가
  // 의존성에 없어 초기 렌더의 null 을 붙잡고 있었다). 타일 에디터의
  // 기존 위반 17건도 정리해 전역으로 켰다.
  {
    files: ["**/*.tsx", "**/*.jsx"],
    rules: { "react-hooks/exhaustive-deps": "error" },
  },
  // 밑줄 접두는 이 저장소에서 "받긴 하지만 일부러 쓰지 않는다" 는 뜻이다
  // (`_fromStatus`, `_catId` …). 규칙에 그 관례를 알려 준다.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // `.js` 는 이 저장소에서 **설계상 CommonJS** 다 — `server.js` 가 런타임에 그대로
  // require 하고, 빌드 단계를 거치지 않는다. 그 파일들에서 `require` 를 금지하는 것은
  // 규칙이 사실과 어긋나는 경우이므로 끈다. `.ts` 쪽의 의도적인 require 는 사이트마다
  // 사유를 적은 disable 로 남긴다(무엇을 왜 부르는지가 파일에 보여야 한다).
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 개발 메타·작업용 워크트리 사본. gitignore 되어 CI 는 애초에 못 보지만,
    // 로컬 `npm run lint` 는 여기까지 훑어 남의 코드로 759건을 뱉는다 —
    // 그러면 로컬과 CI 의 결과가 달라 게이트를 믿을 수 없다.
    ".claude/**",
    ".codex/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
