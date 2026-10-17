import {
  Action,
  ActionPanel,
  Alert,
  Detail,
  Form,
  Icon,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttachedSkill } from "../lib/store";
import { store } from "../lib/store";
import type { OcEvent, OpenCode, PermissionRequest, SessionMessage, Tokens } from "../lib/opencode";
import { messageToMarkdown, tokenSummary, toolInputPreview } from "../lib/format";

/* --------------------------------- model --------------------------------- */

type TextPart = { kind: "text"; text: string };
type ToolPart = {
  kind: "tool";
  id: string;
  name: string;
  input?: unknown;
  rawText?: string;
  status: string;
  output?: string;
};
type Part = TextPart | ToolPart;

type Turn = {
  key: string;
  assistantID?: string;
  user?: string;
  agent?: string;
  model?: string;
  parts: Part[];
  tokens?: Tokens;
  cost?: number;
  finish?: string;
  running: boolean;
};

function upsertText(parts: Part[], ordinal: number, mode: "set" | "append", text: string): Part[] {
  const next = [...parts];
  const existingIndex = next.findIndex((p, i) => p.kind === "text" && i === ordinal);
  if (existingIndex === -1) {
    next.splice(ordinal, 0, { kind: "text", text });
  } else {
    const existing = next[existingIndex] as TextPart;
    next[existingIndex] = { kind: "text", text: mode === "append" ? existing.text + text : text };
  }
  return next;
}

function upsertTool(parts: Part[], toolID: string, patch: Partial<ToolPart> & { name?: string }): Part[] {
  const next = [...parts];
  const idx = next.findIndex((p) => p.kind === "tool" && (p as ToolPart).id === toolID);
  if (idx === -1) {
    next.push({ kind: "tool", id: toolID, name: patch.name ?? "tool", status: patch.status ?? "running", ...patch });
  } else {
    next[idx] = { ...(next[idx] as ToolPart), ...patch };
  }
  return next;
}

/* ------------------------------ view model ------------------------------- */

function turnsFromMessages(messages: SessionMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.type === "user") {
      turns.push({ key: message.id, user: message.text ?? "", parts: [], running: false });
      continue;
    }
    if (message.type === "assistant") {
      const markdown = messageToMarkdown(message);
      const parts: Part[] = markdown ? [{ kind: "text", text: markdown }] : [];
      const last = turns[turns.length - 1];
      const turn: Turn = {
        key: message.id,
        assistantID: message.id,
        agent: message.agent,
        model: message.model?.id,
        parts,
        tokens: message.tokens,
        cost: message.cost,
        finish: message.finish,
        running: false,
      };
      if (last && !last.assistantID && !last.user) turns.push(turn);
      else if (last && !last.assistantID) {
        last.assistantID = turn.assistantID;
        last.agent = turn.agent;
        last.model = turn.model;
        last.parts = turn.parts;
        last.tokens = turn.tokens;
        last.cost = turn.cost;
        last.finish = turn.finish;
      } else turns.push(turn);
    }
  }
  return turns;
}

function renderMarkdown(turns: Turn[], pending: PermissionRequest | null, error?: string): string {
  const out: string[] = [];
  for (const turn of turns) {
    if (turn.user) {
      out.push(`### You\n\n${turn.user}`);
    }
    if (turn.parts.length || turn.running) {
      const header = [`### ${turn.model ? `${turn.model}` : "Assistant"}`];
      if (turn.agent) header.push(`\`agent: ${turn.agent}\``);
      out.push(header.join(" · "));
      const body: string[] = [];
      for (const part of turn.parts) {
        if (part.kind === "text") {
          if (part.text.trim()) body.push(part.text);
        } else {
          const badge = part.status === "completed" ? "✅" : part.status === "failed" ? "❌" : "⏳";
          const preview = toolInputPreview(part.input ?? part.rawText);
          let block = `${badge} \`${part.name}\`${preview ? ` — ${preview}` : ""}`;
          if (part.output)
            block += `\n\n\`\`\`\n${part.output.length > 800 ? `${part.output.slice(0, 800)}…` : part.output}\n\`\`\``;
          body.push(block);
        }
      }
      if (turn.running && !body.length) body.push("_thinking…_");
      out.push(body.join("\n\n"));
    }
  }
  if (pending) {
    out.push(
      `---\n\n> ⚠️ **Permission required** — \`${pending.action}\`\n>\n> \`${pending.resources.join("`, `")}\`\n>\n> Choose allow or deny in the action panel (⌘K).`,
    );
  }
  if (error) out.push(`---\n\n> ❌ ${error}`);
  if (!out.length) out.push("_New chat. Ask something._");
  return out.join("\n\n");
}

/* ------------------------------ chat view -------------------------------- */

export interface ChatViewProps {
  client: OpenCode;
  sessionID: string;
  initialPrompt?: string;
  skills?: AttachedSkill[];
  title?: string;
  onSession?: (id: string) => void;
}

export function ChatView({ client, sessionID, initialPrompt, skills, title }: ChatViewProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<PermissionRequest | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [usage, setUsage] = useState<{ tokens?: Tokens; cost?: number }>({});
  const turnsRef = useRef<Turn[]>([]);
  const pendingRef = useRef<PermissionRequest | null>(null);
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const queuePrompt = useRef<{ text: string; skills?: AttachedSkill[] } | undefined>(
    initialPrompt ? { text: initialPrompt, skills } : undefined,
  );
  const abortRef = useRef<AbortController | null>(null);
  const promptSent = useRef(false);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      setTurns([...turnsRef.current]);
      setPending(pendingRef.current);
    }, 120);
  }, []);

  const mutateTurn = useCallback(
    (assistantID: string | undefined, mutator: (turn: Turn) => Turn) => {
      const list = [...turnsRef.current];
      let index = assistantID ? list.findIndex((t) => t.assistantID === assistantID) : -1;
      if (index === -1) {
        // attach to the newest turn that has a user message but no assistant yet
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].user && !list[i].assistantID) {
            index = i;
            break;
          }
        }
      }
      if (index === -1) {
        list.push({ key: `${Date.now()}`, parts: [], running: true });
        index = list.length - 1;
      }
      const next = mutator(list[index]);
      if (assistantID && !next.assistantID) next.assistantID = assistantID;
      list[index] = next;
      turnsRef.current = list;
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const send = useCallback(
    async (text: string, extraSkills?: AttachedSkill[]) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      turnsRef.current = [
        ...turnsRef.current,
        { key: `user-${Date.now()}`, user: trimmed, parts: [], running: false },
      ];
      scheduleFlush();
      setError(undefined);
      try {
        await client.prompt(sessionID, trimmed, extraSkills?.map((s) => ({ id: s.id })));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, sessionID, scheduleFlush],
  );

  /* history ---------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [messages, perms] = await Promise.all([
          client.messages(sessionID).catch(() => [] as SessionMessage[]),
          client.pendingPermissions(sessionID).catch(() => [] as PermissionRequest[]),
        ]);
        if (cancelled) return;
        turnsRef.current = turnsFromMessages(messages);
        pendingRef.current = perms?.[0] ?? null;
        const lastAssistant = [...messages].reverse().find((m) => m.type === "assistant");
        if (lastAssistant?.tokens) setUsage({ tokens: lastAssistant.tokens, cost: lastAssistant.cost });
        setTurns([...turnsRef.current]);
        setPending(pendingRef.current);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, sessionID]);

  /* event stream ----------------------------------------------------------- */
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      let connectAttempts = 0;
      while (!controller.signal.aborted) {
        try {
          for await (const event of client.streamEvents(controller.signal)) {
            handleEvent(event);
            if (!promptSent.current && queuePrompt.current) {
              promptSent.current = true;
              const queued = queuePrompt.current;
              queuePrompt.current = undefined;
              setStreaming(true);
              void send(queued.text, queued.skills);
            }
          }
        } catch (err) {
          if (controller.signal.aborted) break;
          connectAttempts++;
          if (connectAttempts > 3) {
            setError(err instanceof Error ? err.message : String(err));
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    })();

    function handleEvent(event: OcEvent) {
      const data = event.data ?? {};
      if (data.sessionID && data.sessionID !== sessionID) return;

      switch (event.type) {
        case "session.text.delta":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            running: true,
            parts: upsertText(turn.parts, data.ordinal ?? 0, "append", data.delta ?? ""),
          }));
          break;
        case "session.text.ended":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            parts: upsertText(turn.parts, data.ordinal ?? 0, "set", data.text ?? ""),
          }));
          break;
        case "session.tool.input.started":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            running: true,
            parts: upsertTool(turn.parts, data.id, { name: data.name, status: "running" }),
          }));
          break;
        case "session.tool.input.ended":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            parts: upsertTool(turn.parts, data.id, { rawText: data.text, status: "running" }),
          }));
          break;
        case "session.tool.called":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            parts: upsertTool(turn.parts, data.id, { input: data.input, status: "running" }),
          }));
          break;
        case "session.tool.success":
        case "session.tool.failure":
        case "session.tool.error": {
          const output = (data.content ?? [])
            .map((c: { text?: string }) => c.text ?? "")
            .join("\n")
            .trim();
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            parts: upsertTool(turn.parts, data.id, {
              status: event.type === "session.tool.success" ? "completed" : "failed",
              output,
            }),
          }));
          break;
        }
        case "session.step.ended":
          mutateTurn(data.assistantMessageID, (turn) => ({
            ...turn,
            tokens: data.tokens ?? turn.tokens,
            cost: data.cost ?? turn.cost,
            finish: data.finish,
            running: data.finish === "tool-calls",
          }));
          break;
        case "session.usage.updated":
          setUsage({ tokens: data.tokens, cost: data.cost });
          break;
        case "permission.asked":
          pendingRef.current = data as PermissionRequest;
          scheduleFlush();
          void showToast({
            style: Toast.Style.Failure,
            title: `Permission required: ${data.action}`,
            message: (data.resources ?? []).join(", ").slice(0, 80),
          });
          break;
        case "session.execution.started":
          setStreaming(true);
          break;
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.error":
          setStreaming(false);
          pendingRef.current = null;
          scheduleFlush();
          void client
            .messages(sessionID)
            .then((msgs) => {
              const last = [...msgs].reverse().find((m) => m.type === "assistant");
              if (last?.tokens) setUsage({ tokens: last.tokens, cost: last.cost });
            })
            .catch(() => undefined);
          break;
        default:
          break;
      }
    }

    return () => {
      controller.abort();
    };
  }, [client, sessionID, mutateTurn, scheduleFlush, send]);

  /* actions ---------------------------------------------------------------- */
  const navigation = useNavigation();

  const answerText = useMemo(
    () =>
      turns
        .flatMap((t) => t.parts)
        .filter((p): p is TextPart => p.kind === "text")
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n\n")
        .trim(),
    [turns],
  );

  const reply = async (decision: "once" | "always" | "reject") => {
    const request = pendingRef.current;
    if (!request) return;
    pendingRef.current = null;
    setPending(null);
    try {
      await client.replyPermission(sessionID, request.id, decision);
      if (decision === "reject") setError(`Denied: ${request.action}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const markdown = renderMarkdown(turns, pending, error);
  const totalTokens = usage.tokens;

  return (
    <Detail
      isLoading={loading || streaming}
      navigationTitle={title ?? "OmniRoute chat"}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Session" text={sessionID} icon={Icon.Hashtag} />
          <Detail.Metadata.Label
            title="Status"
            text={streaming ? "streaming" : pending ? "waiting for permission" : "idle"}
            icon={streaming ? Icon.Clock : pending ? Icon.ExclamationMark : Icon.CheckCircle}
          />
          {totalTokens ? (
            <Detail.Metadata.Label title="Tokens" text={tokenSummary(totalTokens)} icon={Icon.BarChart} />
          ) : null}
          {usage.cost !== undefined ? (
            <Detail.Metadata.Label title="Cost" text={String(usage.cost)} icon={Icon.Coins} />
          ) : null}
          {skills?.length ? (
            <Detail.Metadata.TagList title="Skills">
              {skills.map((s) => (
                <Detail.Metadata.TagList.Item key={s.id} text={s.name} color="#22D3EE" />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {pending ? (
            <ActionPanel.Section title="Permission">
              <Action
                title="Allow Once"
                icon={Icon.Check}
                onAction={() => reply("once")}
                shortcut={{ modifiers: ["cmd"], key: "return" }}
              />
              <Action title="Always Allow" icon={Icon.CheckCircle} onAction={() => reply("always")} />
              <Action
                title="Deny"
                icon={Icon.XMarkCircle}
                style={Action.Style.Destructive}
                onAction={() => reply("reject")}
              />
            </ActionPanel.Section>
          ) : null}

          <ActionPanel.Section title="Continue">
            <Action.Push
              title="Reply…"
              icon={Icon.Message}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
              target={<FollowUpForm onSubmit={send} />}
            />
            <Action
              title="New Chat"
              icon={Icon.Plus}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
              onAction={() => navigation.pop()}
            />
            {streaming ? (
              <Action
                title="Stop Generating"
                icon={Icon.Stop}
                shortcut={{ modifiers: ["cmd"], key: "." }}
                onAction={async () => {
                  await client.interrupt(sessionID).catch(() => undefined);
                  setStreaming(false);
                }}
              />
            ) : null}
          </ActionPanel.Section>

          <ActionPanel.Section>
            {answerText ? (
              <>
                <Action.CopyToClipboard title="Copy Answer" content={answerText} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
                <Action.Paste title="Paste Answer to Active App" content={answerText} shortcut={{ modifiers: ["cmd", "shift"], key: "v" }} />
              </>
            ) : null}
            <Action.CopyToClipboard title="Copy Session ID" content={sessionID} />
            <Action
              title="Delete Session"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["ctrl"], key: "x" }}
              onAction={async () => {
                if (await confirmAlert({ title: "Delete this session?", primaryAction: { title: "Delete" } })) {
                  await client.deleteSession(sessionID).catch(() => undefined);
                  navigation.pop();
                }
              }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/* ------------------------------ follow up -------------------------------- */

export function FollowUpForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send"
            icon={Icon.ArrowRight}
            onSubmit={async ({ prompt }: { prompt: string }) => {
              onSubmit(prompt);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="Follow up"
        placeholder="Ask something else…"
        value={text}
        onChange={setText}
        autoFocus
      />
    </Form>
  );
}

export function chatToastStyles() {
  return {
    success: { style: Toast.Style.Success, title: "Done" },
    failureAlert: (title: string, message?: string) =>
      showToast({ style: Toast.Style.Failure, title, message }) as Promise<Toast>,
    showAlert: confirmAlert as typeof confirmAlert,
  };
}

export default ChatView;
