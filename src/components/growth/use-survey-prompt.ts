"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSurvey, type SurveySet } from "./feedback-client";
import { browserStorage, readSurveyState, writeSurveyState } from "./growth-storage";
import { afterSurvey, shouldShowSurvey, type SurveyOutcome } from "./survey-schedule";

const TICK_MS = 60_000;

/**
 * 맵 화면이 보이는 동안 사용 시간을 1분 단위로 쌓고, 때가 되면 설문을 꺼내 준다.
 * 수집 서버가 꺼져 있거나 저장소를 못 쓰면 아무것도 하지 않는다.
 */
export function useSurveyPrompt(feedbackUrl: string | null) {
  const [survey, setSurvey] = useState<SurveySet | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(true);
  // 설문이 떠 있는 동안에는 다시 꺼내지 않는다.
  const openRef = useRef(false);

  useEffect(() => {
    if (!feedbackUrl) return;
    let cancelled = false;
    let fetching = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || fetching || openRef.current) return;
      const storage = browserStorage();
      const state = readSurveyState(storage);
      if (!state) return;
      const next = { ...state, usageMs: state.usageMs + TICK_MS };
      writeSurveyState(storage, next);
      if (!shouldShowSurvey(next, Date.now())) return;
      fetching = true;
      void fetchSurvey(feedbackUrl).then((set) => {
        fetching = false;
        if (cancelled) return;
        openRef.current = true;
        setConsentNeeded(next.consent !== "granted");
        setSurvey(set);
      });
    }, TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [feedbackUrl]);

  const finish = useCallback(
    (outcome: SurveyOutcome) => {
      const storage = browserStorage();
      const state = readSurveyState(storage);
      if (state)
        writeSurveyState(
          storage,
          afterSurvey(state, outcome, Date.now(), survey?.intervalDays ?? 30),
        );
      openRef.current = false;
      setSurvey(null);
    },
    [survey],
  );

  return { survey, consentNeeded, finish };
}
