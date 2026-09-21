import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { watchParent } from "./parent-watch";

type ModuleLoader = {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

async function main(): Promise<void> {
  if (process.env.DESKRPG_CAPTURE_MODE !== "1") {
    throw new Error("The README capture server launcher is capture-only");
  }
  const root = path.resolve(process.env.DESKRPG_PROJECT_ROOT ?? "");
  const entry = path.join(root, "dev-server.ts");
  if (!root || !fs.existsSync(entry)) throw new Error("DeskRPG project root is invalid");

  // 부모(캡처 세션·테스트)가 정리 없이 죽으면 그룹째 끝낸다. 이 런처는 `detached` 로 떠
  // 그룹의 리더이므로 `-pid` 가 Next 가 띄운 작업자까지 함께 가리킨다.
  const parentPid = Number(process.env.DESKRPG_CAPTURE_PARENT_PID);
  if (Number.isInteger(parentPid) && parentPid > 1) {
    watchParent(parentPid, () => {
      console.error(`[readme-capture] parent ${parentPid} is gone; stopping the capture server`);
      try {
        process.kill(-process.pid, "SIGTERM");
      } catch {
        process.exit(1);
      }
    });
  }

  Reflect.set(process, "loadEnvFile", undefined);
  const loader = Module as unknown as ModuleLoader;
  const originalLoad = loader._load;
  loader._load = function captureSafeModuleLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (request !== "@next/env" || !loaded || typeof loaded !== "object") return loaded;
    return {
      ...loaded,
      loadEnvConfig: () => ({
        combinedEnv: process.env,
        parsedEnv: undefined,
        loadedEnvFiles: [],
      }),
    };
  };

  await import(pathToFileURL(entry).href);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
