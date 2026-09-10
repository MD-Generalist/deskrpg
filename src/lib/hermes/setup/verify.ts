import { classifyPluginProbe, type PluginCapability } from "../plugin-capability";

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("json")) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) return null;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Probe identity BEFORE sending a credential, and never follow redirects. */
export async function verifySetupGateway(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PluginCapability> {
  const base = baseUrl.replace(/\/+$/, "");
  const signal = AbortSignal.timeout(15000);
  let health: Response;
  try {
    health = await fetchImpl(`${base}/health`, { redirect: "error", signal });
  } catch {
    throw new Error("gateway_unreachable");
  }
  const identity = (await readJson(health)) as { platform?: string } | null;
  if (!health.ok || identity?.platform !== "hermes-agent") throw new Error("gateway_not_hermes");
  let models: Response;
  try {
    models = await fetchImpl(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
  } catch {
    throw new Error("gateway_unreachable");
  }
  if (models.status === 401 || models.status === 403) throw new Error("gateway_unauthorized");
  const modelData = (await readJson(models)) as { data?: unknown } | null;
  if (!models.ok || !Array.isArray(modelData?.data)) throw new Error("gateway_not_hermes");
  try {
    const plugin = await fetchImpl(`${base}/deskrpg/info`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
    return classifyPluginProbe({ status: plugin.status, body: await readJson(plugin) });
  } catch {
    throw new Error("gateway_unreachable");
  }
}
