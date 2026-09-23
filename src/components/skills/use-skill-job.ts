"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SkillJob } from "@/lib/hermes/plugin-client-types";

import { SkillsApiError, type SkillsApi } from "./skills-api";

export type SkillJobState = "idle" | "running" | "succeeded" | "failed" | "unknown" | "busy";

/** 설치·업데이트·curator 실행 작업을 조회하는 간격과 포기하는 상한(설계 §4.4 — 2초, 5분). */
export const SKILL_JOB_INTERVAL_MS = 2000;
export const SKILL_JOB_TIMEOUT_MS = 300_000;

/**
 * 플러그인의 비동기 작업(202 `{jobId}`)을 끝날 때까지 폴링한다. 언마운트하거나 새 작업을 시작하면
 * 앞 폴링은 세대 번호로 버린다 — 닫은 모달이나 다른 직원의 결과가 화면을 덮지 않는다.
 * 시작이 409 `job_busy` 면 `busy`, 조회가 404 `job_unknown`(게이트웨이 재시작)이거나 상한을 넘기면 `unknown`.
 */
export function useSkillJob(
  api: SkillsApi,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
) {
  const interval = opts.intervalMs ?? SKILL_JOB_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? SKILL_JOB_TIMEOUT_MS;
  const [job, setJob] = useState<SkillJob | null>(null);
  const [state, setState] = useState<SkillJobState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const start = useCallback(
    async (kind: "hub" | "curator", launch: () => Promise<string>) => {
      const gen = ++generation.current;
      const current = () => alive.current && gen === generation.current;
      if (timer.current) clearTimeout(timer.current);
      setJob(null);
      setState("running");
      let jobId: string;
      try {
        jobId = await launch();
      } catch (e) {
        if (current()) {
          setState(e instanceof SkillsApiError && e.code === "job_busy" ? "busy" : "failed");
        }
        return;
      }
      const deadline = Date.now() + timeout;
      const tick = async () => {
        if (!current()) return;
        try {
          const j = await api.job(kind, jobId);
          if (!current()) return;
          setJob(j);
          if (j.state !== "running") {
            setState(j.state);
            return;
          }
        } catch (e) {
          if (current()) {
            setState(
              e instanceof SkillsApiError && e.code === "job_unknown" ? "unknown" : "failed",
            );
          }
          return;
        }
        if (Date.now() > deadline) {
          setState("unknown");
          return;
        }
        timer.current = setTimeout(() => void tick(), interval);
      };
      await tick();
    },
    [api, interval, timeout],
  );

  return { job, state, start };
}
