/** Capture only a loaded model; cancellation disposes it immediately, even mid-load. */
export async function captureWhenReady<T>(
  ready: Promise<boolean>,
  signal: AbortSignal,
  capture: () => T,
  dispose: () => void,
): Promise<T | undefined> {
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
  signal.addEventListener("abort", release, { once: true });
  try {
    if (signal.aborted) return undefined;
    if (!(await ready) || signal.aborted) return undefined;
    return capture();
  } finally {
    signal.removeEventListener("abort", release);
    release();
  }
}
