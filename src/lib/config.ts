import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { OPENCODE_CONFIG } from "./service";
import type { McpConfig } from "./opencode";

export interface OpencodeConfig {
  mcp?: { servers?: Record<string, McpConfig | (McpConfig & Record<string, unknown>)> };
  permissions?: unknown;
  [key: string]: unknown;
}

/** Tolerant parse: opencode config is JSON, but people paste comments and trailing commas. */
function parseTolerant(raw: string): OpencodeConfig {
  try {
    return JSON.parse(raw) as OpencodeConfig;
  } catch {
    const withoutComments = raw
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(withoutComments) as OpencodeConfig;
  }
}

export function readOpencodeConfig(): OpencodeConfig {
  if (!existsSync(OPENCODE_CONFIG)) return {};
  return parseTolerant(readFileSync(OPENCODE_CONFIG, "utf8"));
}

export function configMcpServers(): Record<string, McpConfig> {
  return (readOpencodeConfig().mcp?.servers ?? {}) as Record<string, McpConfig>;
}

export function backupOpencodeConfig(): string | undefined {
  if (!existsSync(OPENCODE_CONFIG)) return undefined;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const target = `${OPENCODE_CONFIG}.bak-raycast-${stamp}`;
  copyFileSync(OPENCODE_CONFIG, target);
  return target;
}

export function writeOpencodeConfig(config: OpencodeConfig): void {
  const tmp = `${OPENCODE_CONFIG}.raycast-tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, OPENCODE_CONFIG);
}

/** Adds, replaces or removes (`config === null`) an MCP server in the global opencode config. */
export function setMcpServer(name: string, config: McpConfig | null): void {
  const current = readOpencodeConfig();
  const servers = { ...(current.mcp?.servers ?? {}) } as Record<string, McpConfig>;
  if (config === null) {
    delete servers[name];
  } else {
    servers[name] = config;
  }
  current.mcp = { ...(current.mcp ?? {}), servers };
  writeOpencodeConfig(current);
}

export function setMcpEnabled(name: string, enabled: boolean): McpConfig | undefined {
  const current = readOpencodeConfig();
  const servers = { ...(current.mcp?.servers ?? {}) } as Record<string, McpConfig>;
  const existing = servers[name];
  if (!existing) return undefined;
  servers[name] = { ...existing, disabled: !enabled };
  current.mcp = { ...(current.mcp ?? {}), servers };
  writeOpencodeConfig(current);
  return servers[name];
}
