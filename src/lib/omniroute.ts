import { readOpencodeConfig } from "./config";

export interface OmnirouteEndpoint {
  baseURL: string;
  apiKey?: string;
}

/** OmniRoute details come from the same opencode config the agent uses. */
export function omnirouteEndpoint(): OmnirouteEndpoint {
  const config = readOpencodeConfig() as {
    provider?: Record<string, { options?: { baseURL?: string; apiKey?: string } }>;
  };
  const provider = config.provider ?? {};
  for (const entry of Object.values(provider)) {
    const baseURL = entry?.options?.baseURL;
    if (typeof baseURL === "string" && baseURL.includes("20128")) {
      return { baseURL: baseURL.replace(/\/+$/, ""), apiKey: entry.options?.apiKey };
    }
  }
  return { baseURL: "http://127.0.0.1:20128/v1" };
}

function authHeaders(endpoint: OmnirouteEndpoint): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
  };
}

export interface ComboProbe {
  ok: boolean;
  latencyMs: number;
  servedBy?: string;
  text?: string;
  error?: string;
}

export async function listCombos(): Promise<string[]> {
  const endpoint = omnirouteEndpoint();
  const res = await fetch(`${endpoint.baseURL}/models`, {
    headers: authHeaders(endpoint),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OmniRoute /models → ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  const ids = (body.data ?? []).map((m) => m.id);
  return ids.filter((id) => !id.includes("/"));
}

export async function allModels(): Promise<string[]> {
  const endpoint = omnirouteEndpoint();
  const res = await fetch(`${endpoint.baseURL}/models`, {
    headers: authHeaders(endpoint),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OmniRoute /models → ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

/** Direct, cheap probe: one tiny completion straight to OmniRoute (no opencode context). */
export async function probeCombo(model: string, prompt = "Reply with exactly: OK"): Promise<ComboProbe> {
  const endpoint = omnirouteEndpoint();
  const started = Date.now();
  try {
    const res = await fetch(`${endpoint.baseURL}/chat/completions`, {
      method: "POST",
      headers: authHeaders(endpoint),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        stream: false,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const latencyMs = Date.now() - started;
    const body = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      return { ok: false, latencyMs, error: body.error?.message ?? `${res.status} ${res.statusText}` };
    }
    return {
      ok: true,
      latencyMs,
      servedBy: body.model,
      text: body.choices?.[0]?.message?.content?.trim(),
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SearxngStatus {
  reachable: boolean;
  results?: number;
  error?: string;
}

export async function searxngStatus(): Promise<SearxngStatus> {
  try {
    const res = await fetch("http://127.0.0.1:8888/search?q=test&format=json", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { reachable: false, error: `${res.status} ${res.statusText}` };
    const body = (await res.json()) as { results?: unknown[] };
    return { reachable: true, results: body.results?.length ?? 0 };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function omnirouteHealth(): Promise<{ reachable: boolean; models?: number; error?: string }> {
  try {
    const endpoint = omnirouteEndpoint();
    const res = await fetch(`${endpoint.baseURL}/models`, {
      headers: authHeaders(endpoint),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { reachable: false, error: res.status === 401 ? "invalid API key" : `${res.status}` };
    const body = (await res.json()) as { data?: unknown[] };
    return { reachable: true, models: body.data?.length ?? 0 };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
