import { Action, ActionPanel, Detail, Icon, List, Toast, open, showToast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { OpenCode, type SkillInfo } from "./lib/opencode";
import { store, type AttachedSkill } from "./lib/store";

export default function SkillsCommand() {
  const { push } = useNavigation();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [attached, setAttached] = useState<AttachedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load() {
    setLoading(true);
    try {
      const client = await OpenCode.connect();
      const [list, attachedList] = await Promise.all([client.skills(), store.attachedSkills()]);
      setSkills([...list].sort((a, b) => a.name.localeCompare(b.name)));
      setAttached(attachedList);
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

  async function toggle(skill: SkillInfo) {
    const next = await store.toggleAttachedSkill({ id: skill.id, name: skill.name });
    setAttached(next);
    await showToast({
      style: Toast.Style.Success,
      title: next.some((s) => s.id === skill.id) ? `Attached ${skill.name}` : `Detached ${skill.name}`,
      message: "Used by the next chat from Ask OmniRoute",
    });
  }

  async function activateInLastSession(skill: SkillInfo) {
    const sessionID = await store.lastSessionID();
    if (!sessionID) {
      await showToast({ style: Toast.Style.Failure, title: "No recent chat", message: "Start a chat first" });
      return;
    }
    try {
      const client = await OpenCode.connect();
      await client.activateSkill(sessionID, skill.id);
      await showToast({ style: Toast.Style.Success, title: `Activated in ${sessionID.slice(0, 12)}…` });
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Activation failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const attachedIDs = new Set(attached.map((a) => a.id));

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
    <List isLoading={loading} searchBarPlaceholder={`Search ${skills.length} skills…`} isShowingDetail={false}>
      {attached.length ? (
        <List.Section
          title="Attached to next chat"
          subtitle="sent with the prompt — needs a full agent (the lean `raycast` agent has skills turned off)"
        >
          {attached.map((skill) => (
            <List.Item
              key={`attached-${skill.id}`}
              icon={{ source: Icon.Paperclip, tintColor: "#22D3EE" }}
              title={skill.name}
              accessories={[{ tag: { value: "attached", color: "#22D3EE" } }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Detach"
                    icon={Icon.XMarkCircle}
                    onAction={async () => {
                      const next = await store.toggleAttachedSkill(skill);
                      setAttached(next);
                    }}
                  />
                  <Action
                    title="Activate in Last Chat"
                    icon={Icon.Play}
                    onAction={() => {
                      const found = skills.find((s) => s.id === skill.id);
                      if (found) void activateInLastSession(found);
                    }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      <List.Section title="All skills" subtitle={`${skills.length}`}>
        {skills.map((skill) => (
          <List.Item
            key={skill.id}
            icon={attachedIDs.has(skill.id) ? { source: Icon.Paperclip, tintColor: "#22D3EE" } : Icon.Book}
            title={skill.name}
            subtitle={skill.description?.slice(0, 90)}
            accessories={[{ text: skill.id }]}
            actions={
              <ActionPanel>
                <Action.Push title="Show Skill" icon={Icon.Eye} target={<SkillDetail skill={skill} />} />
                <Action
                  title={attachedIDs.has(skill.id) ? "Detach from Next Chat" : "Attach to Next Chat"}
                  icon={Icon.Paperclip}
                  onAction={() => toggle(skill)}
                />
                <Action title="Activate in Last Chat" icon={Icon.Play} onAction={() => activateInLastSession(skill)} />
                <Action title="Open SKILL.md" icon={Icon.Document} onAction={() => open(skill.path)} />
                <Action.CopyToClipboard title="Copy Path" content={skill.path} />
                <Action.CopyToClipboard title="Copy Content" content={skill.content} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

function SkillDetail({ skill }: { skill: SkillInfo }) {
  return (
    <Detail
      navigationTitle={skill.name}
      markdown={`# ${skill.name}\n\n\`${skill.path}\`\n\n---\n\n${skill.content.slice(0, 12000)}`}
      actions={
        <ActionPanel>
          <Action title="Open SKILL.md" icon={Icon.Document} onAction={() => open(skill.path)} />
          <Action.CopyToClipboard title="Copy Path" content={skill.path} />
          <Action.CopyToClipboard title="Copy Content" content={skill.content} />
        </ActionPanel>
      }
    />
  );
}
