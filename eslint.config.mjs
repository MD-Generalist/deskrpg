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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
