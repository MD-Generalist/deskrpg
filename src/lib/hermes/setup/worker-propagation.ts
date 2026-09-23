/**
 * 워커 전파 옵트인(플러그인 0.16.0) — 마법사·갱신·"설정에서 켜기" 가 같이 쓰는 판단.
 *
 * 운영자 설정(루트 config `plugins.entries.deskrpg.worker_propagation`)은 호스트 헬퍼가 쓰고,
 * 플러그인은 읽기만 한다. 켜면 이어서 기존 적용(`POST /deskrpg/worker-plugin`)을 불러 이미 고용된
 * 직원에게도 링크를 만든다. 끄기는 새 프로필에 전파하지 않게 할 뿐 — 이미 있는 링크는 플러그인이
 * 지우지 않는다.
 *
 * DB·호스트 접근은 전부 주입받는다(테스트가 판단만 고정한다).
 */
import type { PluginInfo, WorkerPropagation } from "../deskrpg-plugin-types";
import {
  applyWorkerPlugin,
  WORKER_PLUGIN_CAPABILITY,
  type ApplyWorkerPluginDeps,
  type WorkerPluginResult,
} from "../worker-plugin";
import type { SetupCandidate } from "./types";

/**
 * 플러그인 갱신 때 이어받는가. 플러그인이 전파한 링크가 남아 있는데(옛 버전은 기본으로 켜져 있었다)
 * 설정이 꺼져 있으면, 갱신한 뒤 새 직원만 빠지는 일이 없게 켠 채로 이어받는다. 링크가 없으면 운영자가
 * 켠 적이 없으므로 기본 꺼짐을 지킨다. 모르는 값이면 건드리지 않는다.
 */
export function inheritedWorkerPropagation(
  candidate: Pick<SetupCandidate, "workerLinked" | "workerPropagation">,
): boolean {
  return candidate.workerLinked === true && candidate.workerPropagation === "disabled";
}

/** 마법사가 준비를 마친 뒤 기존 적용까지 부르는가 — 켜기를 골랐고, 실제로 켜졌고, 플러그인이 지원할 때. */
export function setupWorkerPluginApplies(
  requested: boolean | undefined,
  propagation: WorkerPropagation | undefined,
  info: Pick<PluginInfo, "capabilities"> | null,
): boolean {
  return (
    requested === true &&
    propagation === "enabled" &&
    Boolean(info?.capabilities.includes(WORKER_PLUGIN_CAPABILITY))
  );
}

export type WorkerPropagationResponse =
  | { propagation: WorkerPropagation; results?: WorkerPluginResult[] }
  | { propagation: WorkerPropagation; errorCode: string };

export type RunWorkerPropagationDeps = ApplyWorkerPluginDeps & {
  /** 호스트 헬퍼 `set-worker-propagation` — 실제 상태를 돌려준다(.env 변수가 켜 두면 끄기를 써도 enabled). */
  setFlag(enabled: boolean): Promise<WorkerPropagation>;
};

/**
 * 플래그를 쓰고, 켜졌으면 기존 적용을 부른다. 어느 쪽이든 플러그인 정보 캐시를 다시 채워 게이트웨이
 * 목록이 새 상태를 보게 한다(적용 경로는 `applyWorkerPlugin` 이 채운다). 적용 실패는 플래그 결과와 함께
 * 플러그인 코드로 돌려준다 — 플래그는 이미 쓰였다.
 */
export async function runWorkerPropagation(
  enabled: boolean,
  deps: RunWorkerPropagationDeps,
): Promise<WorkerPropagationResponse> {
  const propagation = await deps.setFlag(enabled);
  if (!enabled || propagation !== "enabled") {
    try {
      await deps.refreshCache();
    } catch {
      // 결과가 정본이다. 캐시는 다음 프로브가 채운다.
    }
    return { propagation };
  }
  const outcome = await applyWorkerPlugin(deps);
  return outcome.ok
    ? { propagation, results: outcome.results }
    : { propagation, errorCode: outcome.errorCode };
}
