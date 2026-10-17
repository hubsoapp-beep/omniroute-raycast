import {
  Action,
  ActionPanel,
  Alert,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  confirmAlert,
  open,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { OpenCode, type McpConfig, type McpServer } from "./lib/opencode";
import { configMcpServers, setMcpEnabled, setMcpServer } from "./lib/config";
import { OPENCODE_CONFIG } from "./lib/service";
import { statusColor } from "./lib/format";

export default function McpCommand() {
  const { push } = useNavigation();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [configs, setConfigs] = useState<Record<string, McpConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const client = await OpenCode.connect();
      const list = await client.mcpServers();
      setServers([...list].sort((a, b) => a.name.localeCompare(b.name)));
      setConfigs(configMcpServers());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutate(action: () => Promise<void>, successTitle: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `${successTitle}…` });
    try {
      await action();
      toast.style = Toast.Style.Success;
      toast.title = successTitle;
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = `${successTitle} failed`;
      toast.message = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
    await load(false);
  }

  const client = async () => OpenCode.connect();

  return (
    <List isLoading={loading} searchBarPlaceholder="Search MCP servers…">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="opencode service unavailable"
          description={error}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => load()} />
            </ActionPanel>
          }
        />
      ) : null}

      <List.Section title="MCP servers" subtitle={`${servers.length} configured in ~/.config/opencode/opencode.json`}>
        {servers.map((server) => {
          const config = configs[server.name];
          const status = server.status.status;
          const enabled = status !== "disabled";
          return (
            <List.Item
              key={server.name}
              icon={{ source: Icon.Plug, tintColor: statusColor(status) }}
              title={server.name}
              subtitle={config ? (config.type === "local" ? config.command?.join(" ") : config.url) : undefined}
              accessories={
                [
                  { tag: { text: status, color: statusColor(status) } },
                  ...(server.status.error ? [{ text: server.status.error.slice(0, 40) }] : []),
                ] as List.Item.Accessory[]
              }
              detail={
                <List.Item.Detail
                  markdown={`### ${server.name}\n\n**Status:** \`${status}\`\n\n${
                    server.status.error ? `**Error:** ${server.status.error}\n\n` : ""
                  }\`\`\`json\n${JSON.stringify(config ?? { note: "not present in global config" }, null, 2)}\n\`\`\``}
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Connect"
                    icon={Icon.Play}
                    onAction={() => mutate(async () => void (await (await client()).connectMcp(server.name)), `Connected ${server.name}`)}
                  />
                  <Action
                    title="Disconnect"
                    icon={Icon.Stop}
                    onAction={() => mutate(async () => void (await (await client()).disconnectMcp(server.name)), `Disconnected ${server.name}`)}
                  />
                  <Action
                    title={enabled ? "Disable (write config)" : "Enable (write config)"}
                    icon={enabled ? Icon.CircleDisabled : Icon.CheckCircle}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                    onAction={() =>
                      mutate(async () => {
                        setMcpEnabled(server.name, !enabled);
                        await (await client()).reloadConfig();
                      }, enabled ? `Disabled ${server.name}` : `Enabled ${server.name}`)
                    }
                  />
                  <Action
                    title="Delete from Config"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={async () => {
                      if (
                        !(await confirmAlert({
                          title: `Remove ${server.name}?`,
                          message: "Deletes the entry from the global opencode config (a backup is written first).",
                          primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
                        }))
                      )
                        return;
                      await mutate(async () => {
                        setMcpServer(server.name, null);
                        await (await client()).reloadConfig();
                      }, `Removed ${server.name}`);
                    }}
                  />
                  <Action.CopyToClipboard title="Copy Config JSON" content={JSON.stringify(config ?? {}, null, 2)} />
                  <Action title="Add MCP Server…" icon={Icon.Plus} shortcut={{ modifiers: ["cmd"], key: "n" }} onAction={() => push(<AddMcpForm onDone={() => load(false)} />)} />
                  <Action
                    title="Reload Config"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => mutate(async () => void (await (await client()).reloadConfig()), "Config reloaded")}
                  />
                  <Action title="Open opencode.json" icon={Icon.Document} onAction={() => open(OPENCODE_CONFIG)} />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>

      <List.Section title="Actions">
        <List.Item
          icon={Icon.Plus}
          title="Add MCP Server"
          subtitle="stdio command or remote URL"
          actions={
            <ActionPanel>
              <Action title="Add MCP Server…" onAction={() => push(<AddMcpForm onDone={() => load(false)} />)} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Document}
          title="Open opencode.json"
          subtitle={OPENCODE_CONFIG}
          actions={
            <ActionPanel>
              <Action title="Open Config" onAction={() => open(OPENCODE_CONFIG)} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

interface AddFormValues {
  name: string;
  type: "local" | "remote";
  command: string;
  url: string;
  env: string;
  headers: string;
  disabled: boolean;
}

function parseKeyValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function AddMcpForm({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  const [type, setType] = useState<"local" | "remote">("local");

  return (
    <Form
      navigationTitle="Add MCP Server"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save & Connect"
            icon={Icon.Check}
            onSubmit={async (values: AddFormValues) => {
              const name = values.name.trim();
              if (!name) {
                await showToast({ style: Toast.Style.Failure, title: "Name is required" });
                return;
              }
              const toast = await showToast({ style: Toast.Style.Animated, title: `Saving ${name}…` });
              try {
                const config: McpConfig =
                  type === "local"
                    ? {
                        type: "local",
                        command: values.command.trim().split(/\s+/),
                        environment: parseKeyValues(values.env ?? ""),
                        ...(values.disabled ? { disabled: true } : {}),
                      }
                    : {
                        type: "remote",
                        url: values.url.trim(),
                        headers: parseKeyValues(values.headers ?? ""),
                        ...(values.disabled ? { disabled: true } : {}),
                      };
                if (config.type === "local" && (!config.command || config.command.length === 0 || !config.command[0])) {
                  throw new Error("command is required for a local server");
                }
                if (config.type === "remote" && !/^https?:\/\//.test(config.url)) {
                  throw new Error("a remote server needs an http(s) URL");
                }
                setMcpServer(name, config);
                const client = await OpenCode.connect();
                await client.reloadConfig();
                await client.connectMcp(name).catch(() => undefined);
                toast.style = Toast.Style.Success;
                toast.title = `Saved ${name}`;
                toast.message = "written to ~/.config/opencode/opencode.json";
                onDone();
                pop();
              } catch (err) {
                toast.style = Toast.Style.Failure;
                toast.title = "Could not save server";
                toast.message = err instanceof Error ? err.message : String(err);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="searxng" autoFocus />
      <Form.Dropdown id="type" title="Type" value={type} onChange={(v) => setType(v as "local" | "remote")}>
        <Form.Dropdown.Item value="local" title="Local (stdio command)" icon={Icon.Terminal} />
        <Form.Dropdown.Item value="remote" title="Remote (HTTP URL)" icon={Icon.Globe} />
      </Form.Dropdown>
      {type === "local" ? (
        <>
          <Form.TextField
            id="command"
            title="Command"
            placeholder="npx -y @agent360/browser-mcp@latest"
            info="Space separated. Absolute paths and ~ are expanded by the shell you configure here."
          />
          <Form.TextArea id="env" title="Environment" placeholder={"SEARXNG_URL=http://127.0.0.1:8888"} info="One KEY=VALUE per line" />
        </>
      ) : (
        <>
          <Form.TextField id="url" title="URL" placeholder="https://example.com/mcp" />
          <Form.TextArea id="headers" title="Headers" placeholder="Authorization=Bearer token" info="One KEY=VALUE per line" />
        </>
      )}
      <Form.Checkbox id="disabled" title="State" label="Add it disabled (enable later)" defaultValue={false} />
      <Form.Description title="Note" text="Saved into the global opencode config. A timestamped backup is written next to it on every change." />
    </Form>
  );
}

export function McpConfigDetail({ name, config }: { name: string; config: McpConfig }) {
  return <Detail markdown={`### ${name}\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``} />;
}
