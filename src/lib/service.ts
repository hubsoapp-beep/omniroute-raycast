import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SUPPORT_DIR = join(homedir(), "Library", "Application Support", "omniroute-raycast");
export const STATE_FILE = join(SUPPORT_DIR, "server.json");
export const LOG_FILE = join(SUPPORT_DIR, "opencode.log");
export const SERVICE_SCRIPT = join(SUPPORT_DIR, "opencode-service.sh");
export const LAUNCHD_LABEL = "pl.netfly.opencode-raycast";
export const PLIST_FILE = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
export const OPENCODE_CONFIG = join(homedir(), ".config", "opencode", "opencode.json");
export const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode");
export const SEARXNG_URL = "http://127.0.0.1:8888";
export const REPO_SEARXNG_DIR = join(homedir(), "Documents", "02_projekty", "00_TESTY", "202610170736_omniroute raycast", "omniroute-raycast", "searxng");

export interface ServerState {
  port: number;
  host: string;
  password: string;
  opencodeBin?: string;
  createdAt?: string;
}

export class ServiceNotInstalledError extends Error {
  constructor() {
    super(
      "opencode service state not found. Run scripts/install-service.sh from the extension repo (or use Settings → Start service).",
    );
  }
}

export function readServerState(): ServerState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as ServerState;
  } catch {
    return null;
  }
}

export async function launchctl(action: "kickstart" | "bootout" | "bootstrap", extra?: string[]): Promise<void> {
  const uid = process.getuid?.() ?? 501;
  const args: string[] = [];
  if (action === "kickstart") args.push("kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`);
  if (action === "bootout") args.push("bootout", `gui/${uid}/${LAUNCHD_LABEL}`);
  if (action === "bootstrap") args.push("bootstrap", `gui/${uid}`, PLIST_FILE);
  await run("/bin/launchctl", [...args, ...(extra ?? [])]).catch(() => undefined);
}

export interface ServiceStatus {
  installed: boolean;
  loaded: boolean;
  pid?: number;
  exitCode?: number;
  reachable: boolean;
  version?: string;
  state: ServerState | null;
}

export async function serviceStatus(): Promise<ServiceStatus> {
  const state = readServerState();
  let loaded = false;
  let pid: number | undefined;
  let exitCode: number | undefined;
  try {
    const { stdout } = await run("/bin/launchctl", ["list"]);
    const line = stdout.split("\n").find((l) => l.includes(LAUNCHD_LABEL));
    if (line) {
      loaded = true;
      const cols = line.split(/\s+/);
      const pidCol = cols[0];
      const statusCol = cols[1];
      if (pidCol && pidCol !== "-") pid = Number(pidCol);
      if (statusCol && statusCol !== "-") exitCode = Number(statusCol);
    }
  } catch {
    /* launchctl unavailable */
  }

  let reachable = false;
  let version: string | undefined;
  if (state) {
    try {
      const res = await fetch(`http://${state.host}:${state.port}/api/info`, {
        headers: { Authorization: basicAuth(state) },
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { version?: string }; version?: string };
        reachable = true;
        version = body.data?.version ?? body.version;
      }
    } catch {
      /* not running */
    }
  }

  return { installed: Boolean(state), loaded, pid, exitCode, reachable, version, state };
}

export function basicAuth(state: ServerState): string {
  return `Basic ${Buffer.from(`opencode:${state.password}`).toString("base64")}`;
}

/** Ensure the host process is up and return its state, starting the launchd job when needed. */
export async function ensureService(): Promise<ServerState> {
  const state = readServerState();
  if (!state) throw new ServiceNotInstalledError();
  const status = await serviceStatus();
  if (status.reachable) return state;
  await launchctl("kickstart");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await serviceStatus();
    if (next.reachable) return state;
  }
  throw new Error(
    `opencode service on ${state.host}:${state.port} did not come up. Check logs: ${LOG_FILE}`,
  );
}
