import { Action, ActionPanel, Icon, List, Toast, open, showToast } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { useEffect, useState } from "react";
import { omnirouteHealth, probeCombo, searxngStatus } from "./lib/omniroute";
import { resolveSettings } from "./lib/prefs";
import { store } from "./lib/store";
import {
  LAUNCHD_LABEL,
  LOG_FILE,
  OPENCODE_CONFIG,
  REPO_SEARXNG_DIR,
  SERVICE_SCRIPT,
  SEARXNG_URL,
  STATE_FILE,
  SUPPORT_DIR,
  launchctl,
  serviceStatus,
  type ServiceStatus,
} from "./lib/service";

const run = promisify(execFile);

export default function SettingsCommand() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [omni, setOmni] = useState<{ reachable: boolean; models?: number; error?: string } | null>(null);
  const [search, setSearch] = useState<{ reachable: boolean; results?: number; error?: string } | null>(null);
  const [settings, setSettings] = useState<{ combo: string; agent: string; directory: string; permissionMode: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [svc, om, sx, resolved] = await Promise.all([
      serviceStatus(),
      omnirouteHealth(),
      searxngStatus(),
      resolveSettings(),
    ]);
    setStatus(svc);
    setOmni(om);
    setSearch(sx);
    setSettings({
      combo: resolved.combo,
      agent: resolved.agent,
      directory: resolved.directory,
      permissionMode: resolved.permissionMode,
    });
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function restartService() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Restarting opencode service…" });
    try {
      await launchctl("kickstart");
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const next = await serviceStatus();
        if (next.reachable) {
          toast.style = Toast.Style.Success;
          toast.title = "Service up";
          toast.message = `pid ${next.pid} · port ${next.state?.port}`;
          setStatus(next);
          return;
        }
      }
      throw new Error("did not become reachable in 15s — check the log");
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Restart failed";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  async function smokeTest() {
    const combo = settings?.combo ?? "Free Stack";
    const toast = await showToast({ style: Toast.Style.Animated, title: `Probing ${combo}…` });
    const probe = await probeCombo(combo);
    if (probe.ok) {
      toast.style = Toast.Style.Success;
      toast.title = `${combo} → ${(probe.latencyMs / 1000).toFixed(1)}s`;
      toast.message = `served by ${probe.servedBy ?? "?"}`;
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = `${combo} failed`;
      toast.message = probe.error;
    }
  }

  const serviceHealth = status?.reachable ? "reachable" : status?.loaded ? "loaded, not answering" : "not loaded";

  return (
    <List isLoading={loading} searchBarPlaceholder="Filter health checks…">
      <List.Section title="opencode service (the brain)">
        <List.Item
          icon={{ source: status?.reachable ? Icon.CheckCircle : Icon.XMarkCircle, tintColor: status?.reachable ? "#34C759" : "#FF453A" }}
          title="Service status"
          subtitle={`${serviceHealth}${status?.pid ? ` · pid ${status.pid}` : ""}${status?.version ? ` · v${status.version}` : ""}`}
          accessories={[{ text: status?.state ? `${status.state.host}:${status.state.port}` : "state file missing" }]}
          detail={
            <List.Item.Detail
              markdown={`### opencode service\n\n| field | value |\n| --- | --- |\n| label | \`${LAUNCHD_LABEL}\` |\n| loaded | ${status?.loaded ? "yes" : "no"} |\n| pid | ${status?.pid ?? "—"} |\n| exit code | ${status?.exitCode ?? "—"} |\n| port | ${status?.state?.port ?? "—"} |\n| version | ${status?.version ?? "—"} |\n| reachable | ${status?.reachable ? "yes" : "no"} |\n\nState file: \`${STATE_FILE}\`\n\nLog: \`${LOG_FILE}\``}
            />
          }
          actions={
            <ActionPanel>
              <Action title="Restart Service" icon={Icon.ArrowClockwise} onAction={restartService} />
              <Action title="Open Log" icon={Icon.Document} onAction={() => open(LOG_FILE)} />
              <Action title="Open Service Script" icon={Icon.Terminal} onAction={() => open(SERVICE_SCRIPT)} />
              <Action title="Open State Folder" icon={Icon.Folder} onAction={() => open(SUPPORT_DIR)} />
              <Action.CopyToClipboard
                title="Copy Install Command"
                content={`bash "${SERVICE_SCRIPT}" # or re-run scripts/install-service.sh from the repo`}
              />
              <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Dependencies">
        <List.Item
          icon={{ source: omni?.reachable ? Icon.CheckCircle : Icon.XMarkCircle, tintColor: omni?.reachable ? "#34C759" : "#FF453A" }}
          title="OmniRoute"
          subtitle={omni?.reachable ? `${omni.models} models · combos available` : (omni?.error ?? "unreachable")}
          accessories={[{ text: "127.0.0.1:20128" }]}
          actions={
            <ActionPanel>
              <Action title="Open Dashboard" icon={Icon.Globe} onAction={() => open("http://127.0.0.1:20128/dashboard")} />
              <Action title="Live Combo Probe" icon={Icon.Bolt} onAction={smokeTest} />
              <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={{ source: search?.reachable ? Icon.CheckCircle : Icon.XMarkCircle, tintColor: search?.reachable ? "#34C759" : "#FF453A" }}
          title="SearXNG (web_search / web_fetch)"
          subtitle={search?.reachable ? `reachable · ${search.results} results on probe query` : (search?.error ?? "unreachable")}
          accessories={[{ text: SEARXNG_URL }]}
          actions={
            <ActionPanel>
              <Action title="Open SearXNG" icon={Icon.Globe} onAction={() => open(SEARXNG_URL)} />
              <Action
                title="Start / Update Container"
                icon={Icon.Play}
                onAction={async () => {
                  const toast = await showToast({ style: Toast.Style.Animated, title: "docker compose up -d…" });
                  try {
                    await run("/usr/local/bin/docker", ["compose", "up", "-d"], { cwd: REPO_SEARXNG_DIR }).catch(() =>
                      run("/opt/homebrew/bin/docker", ["compose", "up", "-d"], { cwd: REPO_SEARXNG_DIR }),
                    );
                    toast.style = Toast.Style.Success;
                    toast.title = "SearXNG container up";
                    setTimeout(() => void load(), 4000);
                  } catch (err) {
                    toast.style = Toast.Style.Failure;
                    toast.title = "docker compose failed";
                    toast.message = err instanceof Error ? err.message : String(err);
                  }
                }}
              />
              <Action title="Open Compose Folder" icon={Icon.Folder} onAction={() => open(REPO_SEARXNG_DIR)} />
              <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Defaults (override preferences)">
        <List.Item
          icon={Icon.Stars}
          title="Combo"
          subtitle={settings?.combo}
          actions={
            <ActionPanel>
              <Action title="Set from Preferences" onAction={async () => {
                await store.setDefaultCombo("");
                await showToast({ style: Toast.Style.Success, title: "Cleared override" });
                void load();
              }} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Person}
          title="Agent"
          subtitle={settings?.agent}
          actions={
            <ActionPanel>
              <Action
                title="Clear Override"
                onAction={async () => {
                  await store.setDefaultAgent("");
                  await showToast({ style: Toast.Style.Success, title: "Cleared override" });
                  void load();
                }}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Folder}
          title="Working directory"
          subtitle={settings?.directory}
          actions={
            <ActionPanel>
              <Action title="Open Directory" icon={Icon.Folder} onAction={() => settings && open(settings.directory)} />
              <Action
                title="Clear Override"
                onAction={async () => {
                  await store.setLastDirectory("");
                  await showToast({ style: Toast.Style.Success, title: "Cleared override" });
                  void load();
                }}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Lock}
          title="Permissions"
          subtitle={settings?.permissionMode}
          actions={
            <ActionPanel>
              <Action
                title="Guarded (ask for shell / writes)"
                onAction={async () => {
                  await store.setPermissionMode("guarded");
                  await showToast({ style: Toast.Style.Success, title: "Guarded" });
                  void load();
                }}
              />
              <Action
                title="Unrestricted"
                onAction={async () => {
                  await store.setPermissionMode("open");
                  await showToast({ style: Toast.Style.Success, title: "Unrestricted" });
                  void load();
                }}
              />
              <Action
                title="Read-only"
                onAction={async () => {
                  await store.setPermissionMode("readonly");
                  await showToast({ style: Toast.Style.Success, title: "Read-only" });
                  void load();
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Files">
        <List.Item
          icon={Icon.Document}
          title="opencode.json"
          subtitle={existsSync(OPENCODE_CONFIG) ? OPENCODE_CONFIG : "not found"}
          actions={
            <ActionPanel>
              <Action title="Open Config" onAction={() => open(OPENCODE_CONFIG)} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Document}
          title="SearXNG settings.yml"
          subtitle={`${REPO_SEARXNG_DIR}/settings.yml`}
          actions={
            <ActionPanel>
              <Action title="Open Settings" onAction={() => open(`${REPO_SEARXNG_DIR}/settings.yml`)} />
              <Action title="Open docker-compose.yml" onAction={() => open(`${REPO_SEARXNG_DIR}/docker-compose.yml`)} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}
