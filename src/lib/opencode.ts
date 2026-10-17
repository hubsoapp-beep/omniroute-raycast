import { basicAuth, ensureService, type ServerState } from "./service";

/* ------------------------------- types ---------------------------------- */

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export interface Capabilities {
  tools?: boolean;
  input?: string[];
  output?: string[];
  temperature?: boolean;
}

export interface ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name?: string;
  capabilities?: Capabilities;
  variants?: { id: string; settings?: unknown }[];
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode?: "primary" | "subagent" | "all";
  hidden?: boolean;
  model?: ModelRef;
  permissions?: PermissionRule[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  autoinvoke?: boolean;
  path: string;
  content: string;
}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}

export interface McpStatus {
  status: "connected" | "pending" | "disabled" | "failed" | "needs_auth";
  error?: string;
}

export interface McpServer {
  name: string;
  status: McpStatus;
  integrationID?: string;
}

export interface McpLocalConfig {
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  disabled?: boolean;
  timeout?: { startup?: number; catalog?: number; execution?: number };
}

export interface McpRemoteConfig {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export type McpConfig = McpLocalConfig | McpRemoteConfig;

export interface SessionInfo {
  id: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  cost?: number;
  tokens?: Tokens;
  time?: { created?: number; updated?: number; idle?: number };
  location?: { directory: string };
  parentID?: string;
  permissions?: PermissionRule[];
}

export interface Tokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      executed?: boolean;
      state?: { status?: string; input?: unknown; content?: { type: string; text?: string }[]; metadata?: Record<string, unknown> };
    }
  | { type: string; text?: string; [k: string]: unknown };

export interface SessionMessage {
  id: string;
  type: "user" | "assistant" | "tool" | "skill" | "idle";
  text?: string;
  agent?: string;
  model?: ModelRef;
  content?: ContentPart[];
  tokens?: Tokens;
  cost?: number;
  finish?: string;
  time?: { created?: number; streamed?: number; completed?: number };
  outcome?: string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  message?: string;
  source?: { type: "tool"; messageID: string; id: string };
}

export interface ServerInfo {
  version?: string;
  pid?: number;
  urls?: string[];
}

export interface OcEvent {
  id: string;
  created: number;
  type: string;
  location?: { directory: string };
  data: Record<string, any>;
}

/* ------------------------------- client --------------------------------- */

export class OpenCode {
  constructor(private state: ServerState) {}

  get base(): string {
    return `http://${this.state.host}:${this.state.port}`;
  }

  get port(): number {
    return this.state.port;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: basicAuth(this.state),
      "Content-Type": "application/json",
      ...(extra ?? {}),
    };
  }

  static async connect(): Promise<OpenCode> {
    const state = await ensureService();
    return new OpenCode(state);
  }

  async request<T = any>(path: string, init?: RequestInit & { location?: string }): Promise<T> {
    const { location, ...rest } = init ?? {};
    let url = `${this.base}${path}`;
    if (location) {
      const sep = path.includes("?") ? "&" : "?";
      url += `${sep}location[directory]=${encodeURIComponent(location)}`;
    }
    const res = await fetch(url, {
      ...rest,
      headers: this.headers(rest.headers as Record<string, string> | undefined),
    });
    const text = await res.text();
    let body: any = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message = body?.error?.message ?? body?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`${path} → ${message}`);
    }
    if (body && typeof body === "object" && "data" in body) return body.data as T;
    return body as T;
  }

  /* ---- meta ---- */
  info() {
    return this.request<ServerInfo>("/api/info");
  }

  agents() {
    return this.request<AgentInfo[]>("/api/agent");
  }

  models() {
    return this.request<ModelInfo[]>("/api/model");
  }

  skills() {
    return this.request<SkillInfo[]>("/api/skill");
  }

  mcpServers() {
    return this.request<McpServer[]>("/api/mcp");
  }

  reloadConfig() {
    return this.request("/api/location/reload", { method: "POST" });
  }

  /* ---- mcp ---- */
  connectMcp(name: string) {
    return this.request(`/api/experimental/mcp/${encodeURIComponent(name)}/connect`, { method: "POST" });
  }

  disconnectMcp(name: string) {
    return this.request(`/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`, { method: "POST" });
  }

  removeMcp(name: string) {
    return this.request(`/api/experimental/mcp/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  addMcp(name: string, config: McpConfig) {
    return this.request(`/api/experimental/mcp/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ config }),
    });
  }

  /* ---- sessions ---- */
  sessions(limit = 50) {
    return this.request<SessionInfo[]>(`/api/session?limit=${limit}`);
  }

  session(id: string) {
    return this.request<SessionInfo>(`/api/session/${id}`);
  }

  createSession(input: {
    title?: string;
    agent?: string;
    model?: ModelRef;
    directory?: string;
    permissions?: PermissionRule[];
  }) {
    return this.request<SessionInfo>("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        agent: input.agent,
        model: input.model,
        location: input.directory ? { directory: input.directory } : undefined,
        permissions: input.permissions,
      }),
    });
  }

  deleteSession(id: string) {
    return this.request(`/api/session/${id}`, { method: "DELETE" });
  }

  messages(id: string) {
    return this.request<SessionMessage[]>(`/api/session/${id}/message`);
  }

  prompt(id: string, text: string, skills?: { id: string }[]) {
    return this.request<SessionMessage>(`/api/session/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, ...(skills?.length ? { skills } : {}) }),
    });
  }

  interrupt(id: string) {
    return this.request(`/api/session/${id}/interrupt`, { method: "POST" });
  }

  setModel(id: string, model: ModelRef) {
    return this.request(`/api/session/${id}/model`, { method: "POST", body: JSON.stringify({ model }) });
  }

  activateSkill(id: string, skillID: string) {
    return this.request(`/api/experimental/session/${id}/skill`, {
      method: "POST",
      body: JSON.stringify({ id: skillID }),
    });
  }

  /* ---- permissions ---- */
  pendingPermissions(id: string) {
    return this.request<PermissionRequest[]>(`/api/session/${id}/permission`);
  }

  replyPermission(sessionID: string, requestID: string, decision: "once" | "always" | "reject", message?: string) {
    return this.request(`/api/session/${sessionID}/permission/${requestID}/reply`, {
      method: "POST",
      body: JSON.stringify({ decision, message }),
    });
  }

  /* ---- web search pass-through (SearXNG provider lives in opencode) ---- */
  websearch(query: string) {
    return this.request<{ providerID: string; results: { url: string; title?: string; content?: string }[] }>(
      "/api/websearch",
      { method: "POST", body: JSON.stringify({ query }) },
    );
  }

  /* ---- events ---- */
  async *streamEvents(signal: AbortSignal): AsyncGenerator<OcEvent> {
    const res = await fetch(`${this.base}/api/event`, {
      headers: { Authorization: basicAuth(this.state), Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`event stream failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!dataLine) continue;
        try {
          yield JSON.parse(dataLine) as OcEvent;
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}
