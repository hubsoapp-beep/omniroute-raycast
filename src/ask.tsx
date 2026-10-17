import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { ChatView } from "./components/ChatView";
import { OpenCode, type AgentInfo, type ModelInfo } from "./lib/opencode";
import { isCombo, modelTitle, permissionRuleset } from "./lib/format";
import { DEFAULT_AGENT, resolveSettings, withPreamble } from "./lib/prefs";
import { store, type AttachedSkill } from "./lib/store";

interface FormValues {
  prompt: string;
  combo: string;
  agent: string;
  directory: string;
  permissionMode: string;
  useLastSession: boolean;
}

export default function AskCommand() {
  const { push } = useNavigation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<AttachedSkill[]>([]);
  const [combo, setCombo] = useState<string>("Free Stack");
  const [agent, setAgent] = useState<string>(DEFAULT_AGENT);
  const [directory, setDirectory] = useState<string>("");
  const [permissionMode, setPermissionMode] = useState<string>("guarded");
  const [lastSession, setLastSession] = useState<{ id: string; title?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      const settings = await resolveSettings();
      setCombo(settings.combo);
      setAgent(settings.agent);
      setDirectory(settings.directory);
      setPermissionMode(settings.permissionMode);
      setSkills(await store.attachedSkills());
      const lastID = await store.lastSessionID();
      try {
        const client = await OpenCode.connect();
        const [allModels, allAgents] = await Promise.all([client.models(), client.agents()]);
        setModels(allModels.filter((m) => m.providerID === "omniroute"));
        setAgents(allAgents.filter((a) => a.mode !== "subagent" && !a.hidden));
        if (lastID) {
          const info = await client.session(lastID).catch(() => undefined);
          if (info) setLastSession({ id: info.id, title: info.title });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const combos = useMemo(() => {
    const list = models.filter(isCombo).map((m) => m.id);
    const rest = models.filter((m) => !isCombo(m)).map((m) => m.id);
    return [...list.sort((a, b) => a.localeCompare(b)), ...rest];
  }, [models]);

  /** Lean agent first so the default is a single Enter away; falls back to `raycast` when absent. */
  const orderedAgents = useMemo<AgentInfo[]>(() => {
    const list = agents.length ? [...agents] : [{ id: DEFAULT_AGENT, name: DEFAULT_AGENT } as AgentInfo];
    return list.sort((a, b) => {
      if (a.id === DEFAULT_AGENT) return -1;
      if (b.id === DEFAULT_AGENT) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents]);

  async function submit(values: FormValues) {
    const prompt = values.prompt?.trim();
    if (!prompt) {
      await showToast({ style: Toast.Style.Failure, title: "Nothing to send" });
      return;
    }
    try {
      const settings = await resolveSettings({
        combo: values.combo,
        agent: values.agent,
        directory: values.directory,
        permissionMode: values.permissionMode as "guarded" | "open" | "readonly",
      });
      const client = await OpenCode.connect();

      await Promise.all([
        store.pushRecentModel(settings.combo),
        store.pushRecentDir(settings.directory),
        store.setDefaultCombo(settings.combo),
        store.setDefaultAgent(settings.agent),
        store.setLastDirectory(settings.directory),
      ]);

      if (values.useLastSession && lastSession) {
        await store.setLastSessionID(lastSession.id);
        push(
          <ChatView
            client={client}
            sessionID={lastSession.id}
            initialPrompt={withPreamble(prompt, settings.preamble)}
            skills={skills}
            title={lastSession.title ?? "OmniRoute chat"}
          />,
        );
        return;
      }

      const session = await client.createSession({
        title: prompt.slice(0, 48),
        agent: settings.agent,
        model: { id: settings.combo, providerID: "omniroute" },
        directory: settings.directory,
        permissions: permissionRuleset(settings.permissionMode),
      });
      await store.setLastSessionID(session.id);
      if (skills.length) await store.setAttachedSkills([]);
      push(
        <ChatView
          client={client}
          sessionID={session.id}
          initialPrompt={withPreamble(prompt, settings.preamble)}
          skills={skills}
          title={prompt.slice(0, 40)}
        />,
      );
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not start the chat",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Form
      isLoading={loading}
      navigationTitle="Ask OmniRoute"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send" icon={Icon.ArrowRight} onSubmit={submit} />
          <Action.Push
            title="Pick Model"
            icon={Icon.Stars}
            target={<ModelPicker combo={combo} combos={combos} onPick={setCombo} />}
          />
          {lastSession ? (
            <Action.CopyToClipboard title="Copy Last Session ID" content={lastSession.id} />
          ) : null}
        </ActionPanel>
      }
    >
      {error ? <Form.Description title="⚠️ Service" text={error} /> : null}
      <Form.TextArea
        id="prompt"
        title="Message"
        placeholder="Ask anything. Tools, MCP servers and skills of your opencode agent are available."
        autoFocus
        enableMarkdown
      />
      <Form.Dropdown id="combo" title="Combo" value={combo} onChange={setCombo}>
        {(combos.length ? combos : [combo]).map((id) => (
          <Form.Dropdown.Item key={id} value={id} title={id} icon={Icon.Stars} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="agent" title="Agent" value={agent} onChange={setAgent}>
        {orderedAgents.map((a) => (
          <Form.Dropdown.Item
            key={a.id}
            value={a.id}
            title={a.id === DEFAULT_AGENT ? `${a.name} — lean` : a.name}
            icon={a.id === "plan" ? Icon.Eye : Icon.Person}
          />
        ))}
      </Form.Dropdown>
      <Form.Description
        title="Agent cost"
        text={
          agent === DEFAULT_AGENT
            ? "Lean: short prompt, skill catalog off — ~10k tokens per message."
            : "Full agent: instructions + skill catalog are sent every message — ~55k tokens."
        }
      />
      <Form.Dropdown id="permissionMode" title="Permissions" value={permissionMode} onChange={setPermissionMode}>
        <Form.Dropdown.Item value="guarded" title="Guarded — ask before shell / writes" icon={Icon.Lock} />
        <Form.Dropdown.Item value="open" title="Unrestricted — allow everything" icon={Icon.LockUnlocked} />
        <Form.Dropdown.Item value="readonly" title="Read-only — no shell, no writes" icon={Icon.Eye} />
      </Form.Dropdown>
      <Form.TextField
        id="directory"
        title="Working directory"
        value={directory}
        onChange={setDirectory}
        placeholder="~/Documents"
      />
      {skills.length ? (
        <Form.Description
          title="Attached skills"
          text={skills.map((s) => s.name).join(", ")}
        />
      ) : null}
      {lastSession ? (
        <Form.Checkbox
          id="useLastSession"
          title="Continue"
          label={`Continue last chat: ${lastSession.title ?? lastSession.id}`}
          defaultValue={false}
        />
      ) : null}
    </Form>
  );
}

function ModelPicker({
  combo,
  combos,
  onPick,
}: {
  combo: string;
  combos: string[];
  onPick: (id: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Use Combo"
            onSubmit={(values: { combo: string }) => {
              onPick(values.combo);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="combo" title="Combo" defaultValue={combo}>
        {combos.map((id) => (
          <Form.Dropdown.Item key={id} value={id} title={id} />
        ))}
      </Form.Dropdown>
      <Form.Description title="Tip" text="Combos are the OmniRoute fallback chains (Free Stack, Coding, Max…). Any provider model id also works." />
    </Form>
  );
}
