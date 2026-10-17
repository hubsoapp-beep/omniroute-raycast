import { Action, ActionPanel, Icon, List, Toast, confirmAlert, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { OpenCode, type SessionInfo } from "./lib/opencode";
import { formatTokens, relativeTime, tokenSummary } from "./lib/format";
import { resolveSettings } from "./lib/prefs";
import { store } from "./lib/store";

export default function ChatsCommand() {
  const { push } = useNavigation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [client, setClient] = useState<OpenCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load() {
    setLoading(true);
    try {
      const c = await OpenCode.connect();
      setClient(c);
      const list = await c.sessions(60);
      setSessions(list.filter((s) => !s.parentID));
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

  async function open(session: SessionInfo, withReply = false) {
    const c = client ?? (await OpenCode.connect());
    await store.setLastSessionID(session.id);
    push(
      <ChatView
        client={c}
        sessionID={session.id}
        initialPrompt={withReply ? undefined : undefined}
        title={session.title ?? "OmniRoute chat"}
      />,
    );
  }

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="opencode service unavailable"
          description={error}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={load} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Search chats by title, model or directory…">
      <List.Section title="Sessions" subtitle={String(sessions.length)}>
        {sessions.map((session) => (
          <List.Item
            key={session.id}
            icon={Icon.Message}
            title={session.title ?? "(untitled)"}
            subtitle={session.model ? `${session.model.providerID}/${session.model.id}` : undefined}
            accessories={[
              { text: session.location?.directory?.replace(/^\/Users\/[^/]+/, "~") },
              { icon: Icon.BarChart, text: formatTokens(session.tokens?.input) },
              { text: relativeTime(session.time?.updated ?? session.time?.created) },
              { text: session.agent },
            ]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Session" text={session.id} />
                    <List.Item.Detail.Metadata.Label
                      title="Model"
                      text={session.model ? `${session.model.providerID}/${session.model.id}` : "—"}
                    />
                    <List.Item.Detail.Metadata.Label title="Agent" text={session.agent ?? "—"} />
                    <List.Item.Detail.Metadata.Label title="Tokens" text={tokenSummary(session.tokens)} />
                    <List.Item.Detail.Metadata.Label title="Cost" text={String(session.cost ?? 0)} />
                    <List.Item.Detail.Metadata.Label title="Directory" text={session.location?.directory ?? "—"} />
                    <List.Item.Detail.Metadata.Label
                      title="Updated"
                      text={new Date(session.time?.updated ?? session.time?.created ?? Date.now()).toLocaleString()}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action title="Open Chat" icon={Icon.Message} onAction={() => open(session)} />
                <Action
                  title="Continue with a New Message"
                  icon={Icon.ArrowRight}
                  onAction={() => open(session, true)}
                />
                <Action.CopyToClipboard title="Copy Session ID" content={session.id} />
                <Action.CopyToClipboard
                  title="Copy Resume Command"
                  content={`opencode --session ${session.id}`}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                />
                <Action
                  title="Delete Session"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={async () => {
                    if (!(await confirmAlert({ title: "Delete this chat?", primaryAction: { title: "Delete" } }))) return;
                    const c = client ?? (await OpenCode.connect());
                    await c.deleteSession(session.id).catch(() => undefined);
                    setSessions((prev) => prev.filter((s) => s.id !== session.id));
                    await showToast({ style: Toast.Style.Success, title: "Session deleted" });
                  }}
                />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Defaults">
        <List.Item
          title="New chat settings"
          icon={Icon.Gear}
          subtitle="Resolved from preferences and last used"
          actions={
            <ActionPanel>
              <Action
                title="Show Resolved Settings"
                onAction={async () => {
                  const s = await resolveSettings();
                  await showToast({
                    style: Toast.Style.Success,
                    title: `${s.combo} · ${s.agent}`,
                    message: `${s.directory} · ${s.permissionMode}`,
                  });
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}
