/** Capture runs suppress diagnostics at their source; normal development is unchanged. */
export function showPerformanceHud(environment: string | undefined, capture: string | undefined) {
  return environment === "development" && capture !== "1";
}
