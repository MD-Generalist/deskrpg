"use client";

import { useCallback, useEffect, useState } from "react";

import { APP_VERSION, isNewer } from "@/lib/app-meta";
import type { AppMeta } from "@/lib/app-meta-server";

import {
  browserStorage,
  readGrowthState,
  writeGrowthFlag,
  type GrowthState,
} from "./growth-storage";

export function useAppMeta() {
  const [meta, setMeta] = useState<AppMeta>({
    version: APP_VERSION,
    latestVersion: null,
    stars: null,
  });
  const [state, setState] = useState<GrowthState>({
    ok: false,
    seenVersion: null,
    starClicked: false,
  });

  useEffect(() => {
    setState(readGrowthState(browserStorage()));
    let cancelled = false;
    fetch("/api/app-meta")
      .then((res) => (res.ok ? (res.json() as Promise<AppMeta>) : null))
      .then((data) => {
        if (data && !cancelled) setMeta(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUpdate =
    state.ok &&
    isNewer(meta.latestVersion, meta.version) &&
    state.seenVersion !== meta.latestVersion;

  const markUpdateSeen = useCallback(() => {
    if (!meta.latestVersion) return;
    writeGrowthFlag(browserStorage(), "seenVersion", meta.latestVersion);
    setState((s) => ({ ...s, seenVersion: meta.latestVersion }));
  }, [meta.latestVersion]);

  const markStarClicked = useCallback(() => {
    writeGrowthFlag(browserStorage(), "starClicked", "1");
    setState((s) => ({ ...s, starClicked: true }));
  }, []);

  return {
    ...meta,
    updateAvailable: isNewer(meta.latestVersion, meta.version),
    hasUpdate,
    starClicked: state.starClicked,
    markUpdateSeen,
    markStarClicked,
  };
}

export type AppMetaView = ReturnType<typeof useAppMeta>;
