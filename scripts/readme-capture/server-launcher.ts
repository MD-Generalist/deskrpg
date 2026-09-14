import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
