import { getPreferenceValues, type PreferenceValues } from "@raycast/api";
import { homedir } from "node:os";
import { store } from "./store";
import { expandHome } from "./format";

/**
 * `raycast` is a slim opencode agent (short system prompt, skill catalog denied) that keeps the
 * per-message context around 10k tokens instead of ~55k. Falls back to `build` if the user's
 * opencode config does not define it.
 */
export const DEFAULT_AGENT = "raycast";

export interface Prefs {
  defaultCombo?: string;
  defaultAgent?: string;
  workingDirectory?: string;
  permissionMode?: string;
  systemPreamble?: string;
}

export function prefs(): Prefs {
  try {
    return getPreferenceValues<PreferenceValues>() as unknown as Prefs;
  } catch {
    return {};
  }
}

export interface ResolvedSettings {
  combo: string;
  agent: string;
  directory: string;
  permissionMode: "guarded" | "open" | "readonly";
  preamble: string;
}

export async function resolveSettings(overrides?: Partial<ResolvedSettings>): Promise<ResolvedSettings> {
  const p = prefs();
  const [comboOverride, agentOverride, modeOverride, dirOverride] = await Promise.all([
    store.defaultCombo(),
    store.defaultAgent(),
    store.permissionMode(),
    store.lastDirectory(),
  ]);
  const mode = (overrides?.permissionMode ?? modeOverride ?? p.permissionMode ?? "guarded") as ResolvedSettings["permissionMode"];
  return {
    combo: overrides?.combo ?? comboOverride ?? p.defaultCombo ?? "Free Stack",
    agent: overrides?.agent ?? agentOverride ?? p.defaultAgent ?? DEFAULT_AGENT,
    directory: expandHome(overrides?.directory ?? dirOverride ?? p.workingDirectory ?? join(homedir(), "Documents")),
    permissionMode: mode,
    preamble: overrides?.preamble ?? p.systemPreamble ?? "",
  };
}

function join(a: string, b: string): string {
  return a.endsWith("/") ? a + b : `${a}/${b}`;
}

export function withPreamble(text: string, preamble: string): string {
  const trimmed = preamble.trim();
  return trimmed ? `${trimmed}\n\n${text}` : text;
}
