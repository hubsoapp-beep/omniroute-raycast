import { Action, ActionPanel, Icon, List, Toast, showToast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { allModels, omnirouteHealth, probeCombo } from "./lib/omniroute";
import { store } from "./lib/store";

export default function ModelsCommand() {
  const [combos, setCombos] = useState<string[]>([]);
  const [all, setAll] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [defaultCombo, setDefaultCombo] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function load() {
    setLoading(true);
    try {
      const health = await omnirouteHealth();
      if (!health.reachable) throw new Error(health.error ?? "OmniRoute not reachable");
      const [comboList, modelList, pinnedList, recentList, storedDefault] = await Promise.all([
        allModels().then((ids) => ids.filter((id) => !id.includes("/"))),
        allModels(),
        store.pinnedModels(),
        store.recentModels(),
        store.defaultCombo(),
      ]);
      setCombos(comboList.sort((a, b) => a.localeCompare(b)));
      setAll(modelList);
      setPinned(pinnedList);
      setRecent(recentList);
      setDefaultCombo(storedDefault ?? "");
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

  const providerModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return all
      .filter((id) => id.includes("/") && id.toLowerCase().includes(q))
      .slice(0, 100);
  }, [all, search]);

  async function togglePin(id: string) {
    const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
    setPinned(next);
    await store.setPinnedModels(next);
    await showToast({ style: Toast.Style.Success, title: pinned.includes(id) ? "Unpinned" : "Pinned", message: id });
  }

  async function setDefault(id: string) {
    await store.setDefaultCombo(id);
    setDefaultCombo(id);
    await showToast({ style: Toast.Style.Success, title: "Default combo set", message: id });
  }

  async function test(id: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Testing ${id}…`, message: "live probe via OmniRoute" });
    const result = await probeCombo(id);
    if (result.ok) {
      toast.style = Toast.Style.Success;
      toast.title = `${id} → ${(result.latencyMs / 1000).toFixed(1)}s`;
      toast.message = `${result.servedBy ?? "?"} · "${(result.text ?? "").slice(0, 60)}"`;
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = `${id} failed`;
      toast.message = (result.error ?? "").slice(0, 120);
    }
  }

  function actions(id: string) {
    return (
      <ActionPanel>
        <Action title="Use as Default Combo" icon={Icon.Star} onAction={() => setDefault(id)} />
        <Action title="Test Combo (Live)" icon={Icon.Bolt} onAction={() => test(id)} />
        <Action
          title={pinned.includes(id) ? "Unpin" : "Pin to Top"}
          icon={Icon.Pin}
          onAction={() => togglePin(id)}
          shortcut={{ modifiers: ["cmd"], key: "p" }}
        />
        <Action.CopyToClipboard title="Copy Model ID" content={id} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
        <Action.CopyToClipboard
          title="Copy OpenAI-compatible cURL"
          content={`curl -s http://127.0.0.1:20128/v1/chat/completions -H "Authorization: Bearer $JCODE_PROVIDER_OMNIROUTE_API_KEY" -H "Content-Type: application/json" -d '{"model":"${id}","messages":[{"role":"user","content":"hi"}]}'`}
        />
        <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={load} />
      </ActionPanel>
    );
  }

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="OmniRoute unreachable"
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
    <List
      isLoading={loading}
      onSearchTextChange={setSearch}
      searchBarPlaceholder="Filter combos, or type to search all 2500+ provider models…"
    >
      {pinned.length ? (
        <List.Section title="Pinned" subtitle="favourites">
          {pinned.map((id) => (
            <List.Item
              key={`pin-${id}`}
              icon={{ source: Icon.Star, tintColor: "#FFD60A" }}
              title={id}
              accessories={defaultCombo === id ? [{ tag: { value: "default", color: "#4C9AFF" } }] : []}
              actions={actions(id)}
            />
          ))}
        </List.Section>
      ) : null}

      {recent.length ? (
        <List.Section title="Recent" subtitle="last used">
          {recent
            .filter((id) => !pinned.includes(id))
            .map((id) => (
              <List.Item
                key={`recent-${id}`}
                icon={Icon.Clock}
                title={id}
                accessories={defaultCombo === id ? [{ tag: { value: "default", color: "#4C9AFF" } }] : []}
                actions={actions(id)}
              />
            ))}
        </List.Section>
      ) : null}

      <List.Section title="Combos" subtitle="fallback chains with quotas spread across providers">
        {combos.map((id) => (
          <List.Item
            key={id}
            icon={{ source: Icon.Stars, tintColor: "#22D3EE" }}
            title={id}
            accessories={defaultCombo === id ? [{ tag: { value: "default", color: "#4C9AFF" } }] : []}
            actions={actions(id)}
          />
        ))}
      </List.Section>

      {providerModels.length ? (
        <List.Section title="Provider models" subtitle="matching your search">
          {providerModels.map((id) => (
            <List.Item key={id} icon={Icon.Hammer} title={id} actions={actions(id)} />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}
