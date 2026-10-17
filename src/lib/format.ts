import { Icon } from "@raycast/api";
import { homedir } from "node:os";
import type { ModelInfo, PermissionRule, SessionMessage, Tokens } from "./opencode";

export const STATUS_ICON: Record<string, Icon> = {
  connected: Icon.CheckCircle,
  pending: Icon.Clock,
  disabled: Icon.Circle,
  failed: Icon.XMarkCircle,
  needs_auth: Icon.Lock,
};

export function statusColor(status: string): string {
  switch (status) {
    case "connected":
      return "#34C759";
    case "pending":
      return "#FF9F0A";
    case "failed":
      return "#FF453A";
    case "needs_auth":
      return "#BF5AF2";
    default:
      return "#8E8E93";
  }
}

export const TOOL_ICONS: Record<string, Icon> = {
  shell: Icon.Terminal,
  read: Icon.Document,
  write: Icon.NewDocument,
  edit: Icon.Pencil,
  grep: Icon.MagnifyingGlass,
  glob: Icon.MagnifyingGlass,
  webfetch: Icon.Globe,
  websearch: Icon.Globe,
  task: Icon.Person,
  subagent: Icon.Person,
  question: Icon.QuestionMark,
  browser: Icon.Window,
};

export function toolIcon(name: string): Icon {
  const key = name.toLowerCase();
  if (TOOL_ICONS[key]) return TOOL_ICONS[key];
  if (key.startsWith("searxng")) return Icon.Globe;
  if (key.includes("search")) return Icon.MagnifyingGlass;
  if (key.includes("browser") || key.includes("playwright")) return Icon.Window;
  return Icon.WrenchScrewdriver;
}

export function expandHome(p: string): string {
  if (!p) return homedir();
  return p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
}

export function formatTokens(n?: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function tokenSummary(tokens?: Tokens): string {
  if (!tokens) return "—";
  const cache = tokens.cache?.read ? ` · cache ${formatTokens(tokens.cache.read)}` : "";
  return `↑ ${formatTokens(tokens.input)} ↓ ${formatTokens(tokens.output)}${cache}`;
}

export function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function isCombo(model: ModelInfo): boolean {
  return !model.id.includes("/") && !model.modelID.includes("/");
}

export function modelTitle(model: ModelInfo): string {
  return model.name && model.name !== model.id ? `${model.id} — ${model.name}` : model.id;
}

export function permissionRuleset(mode: string | undefined): PermissionRule[] | undefined {
  switch (mode) {
    case "open":
      return undefined; // inherit opencode defaults (everything allowed)
    case "readonly":
      return [
        { action: "shell", resource: "*", effect: "deny" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "write", resource: "*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "deny" },
      ];
    case "guarded":
    default:
      return [
        { action: "shell", resource: "*", effect: "ask" },
        { action: "edit", resource: "*", effect: "ask" },
        { action: "write", resource: "*", effect: "ask" },
      ];
  }
}

export function truncate(text: string, max = 320): string {
  const clean = text.replace(/\r/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function toolInputPreview(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return truncate(input, 120);
  const obj = input as Record<string, unknown>;
  const preferred = ["command", "filePath", "path", "pattern", "query", "url", "description", "prompt"];
  for (const key of preferred) {
    const value = obj[key];
    if (typeof value === "string") return truncate(value, 140);
  }
  try {
    return truncate(JSON.stringify(obj), 140);
  } catch {
    return "";
  }
}

/* --------------------------- message rendering --------------------------- */

export function messageToMarkdown(message: SessionMessage): string {
  const parts = message.content ?? [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      chunks.push(part.text);
    } else if (part.type === "tool") {
      const state = (part.state ?? {}) as {
        status?: string;
        input?: unknown;
        content?: { type: string; text?: string }[];
      };
      const status = state.status ?? "unknown";
      const preview = toolInputPreview(state.input);
      const output = (state.content ?? [])
        .map((c: { type: string; text?: string }) => (typeof c.text === "string" ? c.text : ""))
        .join("\n")
        .trim();
      const badge = status === "completed" ? "✅" : status === "failed" ? "❌" : "⏳";
      let block = `**${badge} ${part.name}**${preview ? ` \`${preview}\`` : ""}`;
      if (output) block += `\n\n\`\`\`\n${truncate(output, 600)}\n\`\`\``;
      chunks.push(block);
    }
  }
  return chunks.join("\n\n").trim();
}
