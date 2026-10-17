# OmniRoute for Raycast

Chat with your OmniRoute combos from Raycast. `opencode serve` is the brain: it owns the models,
agents, tools, MCP servers and skills, and the extension is only the window onto it.

```
Raycast extension ──HTTP/SSE──▶ opencode serve (launchd, 127.0.0.1:20131)
                                      │
                                      ├─▶ OmniRoute  (127.0.0.1:20128/v1)  ← the combo LLMs
                                      ├─▶ MCP servers (searxng, browser-mcp, playwright, …)
                                      └─▶ shell / read / grep / write in the working directory
```

## What you need

| Piece | Where it runs | Default |
|---|---|---|
| OmniRoute | OrbStack container `omniroute` (already running) | `http://127.0.0.1:20128` |
| opencode server | launchd agent `pl.netfly.opencode-raycast` | `127.0.0.1:20131` |
| SearXNG | OrbStack container `searxng` | `127.0.0.1:8888` |
| SearXNG MCP wrapper | stdio, spawned by opencode | `mcp-searxng/index.mjs` |

Node 22+, Raycast, Docker (OrbStack).

## Setup

```bash
npm install
npm run service:install     # launchd agent, password, server.json  (once)
cp searxng/.env.example searxng/.env
printf 'SEARXNG_SECRET=%s\n' "$(openssl rand -hex 32)" > searxng/.env
npm run search:up           # SearXNG container                     (once)
npm run dev                 # ray develop → extension in dev mode
```

No API key lives in this repository. The OmniRoute key is read at runtime from your own
`~/.config/opencode/opencode.json`, and the opencode server password is generated locally into
`~/Library/Application Support/omniroute-raycast/server.json` (mode 0600).

Then open Raycast and run **Ask OmniRoute**.

Verify at any time:

```bash
npm run smoke          # 12-check end-to-end: service, agents, models, stream, permissions
npm run mcp:selftest   # SearXNG MCP wrapper: handshake, tools/list, live search, web_fetch
npm run lint
```

## Commands

| Command | What it does |
|---|---|
| **Ask OmniRoute** | Compose a prompt: combo, agent, permissions, directory; continues the last chat if you want. Streams markdown, shows tool calls, raises permission prompts. |
| **Chats** | Every opencode session; reopen one, rename, delete, copy transcript. |
| **Models & Combos** | The 8 OmniRoute combos plus any provider model; sets the default, pins favourites. |
| **MCP Servers** | Enable/disable/remove/add MCP servers — the extra powers. |
| **Skills** | Browse opencode skills, attach one to the next chat, open its `SKILL.md`. |
| **Settings & Health** | Service start/stop/restart, log tail, SearXNG status, live combo test, permission mode. |

## Token cost: use the `raycast` agent

Every message sends the whole system prompt. With a full agent that includes the **entire skill
catalog**: ~396 skills, each with its description. Measured on the live service with combo `Fast`:

| Agent | Input tokens per message | What is in the prompt |
|---|---|---|
| `raycast` (default) | **~9.7k** | short system prompt, code-mode catalog, MCP instructions |
| `build` (full) | **~55k** | same + skill catalog (~40k) |

The `raycast` agent is defined in `~/.config/opencode/opencode.json`:

```json
"agents": {
  "raycast": {
    "mode": "primary",
    "steps": 24,
    "permissions": [{ "action": "skill", "resource": "*", "effect": "deny" }],
    "system": "…short prompt…"
  }
}
```

Denying the `skill` action is what removes the catalog. Consequences: chats on the lean agent
cannot load skills. Pick `build` in the Ask form when you want skills (and pay the ~55k baseline).
A config-level way to shrink the catalog does not exist — `skills: []` is additive, and
`OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` only removes the 13 `~/.claude/skills` entries.

## Permissions (HITL)

A session-level ruleset is built from the chosen mode and sent when the chat starts:

| Mode | shell / write / edit |
|---|---|
| Guarded (default) | `ask` — the chat shows a banner, nothing runs until you answer |
| Unrestricted | inherit opencode defaults |
| Read-only | `deny` — no shell, no writes |

Reads, web and MCP reads are always allowed. When the agent wants to run something, the chat shows
the exact command with **Allow once / Always allow / Deny**; the answer goes back to opencode over
`POST /api/session/{id}/permission/{requestID}/reply` and execution resumes.

## MCP servers

The MCP screen edits the **global config** `~/.config/opencode/opencode.json` (a timestamped backup
is written next to it, then an atomic rename) and calls `POST /api/location/reload`. Per-server
routes such as `PUT /api/experimental/mcp/{name}` change the running server only and are lost on
restart — that is why the file is the source of truth.

`searxng` is registered there as a local stdio server; it exposes `web_search` and `web_fetch` and
needs the container from `npm run search:up`.

## Service

`scripts/install-service.sh` writes `~/Library/Application Support/omniroute-raycast/`:

```
opencode-service.sh   launcher (lives outside ~/Documents: launchd cannot exec from there)
server.json           port + password, mode 0600
opencode.log          server log
```

The password comes from `OPENCODE_SERVER_PASSWORD` and is reused by extension and CLI; the auth
header is `Basic base64("opencode:<password>")`. Port 20131 was chosen because 20130 is already
taken by an unrelated listener.

```bash
launchctl list | grep opencode-raycast
tail -f ~/Library/Application\ Support/omniroute-raycast/opencode.log
npm run service:uninstall
```

Do not touch the separately running `opencode serve --service` (a different port) — it belongs to
your other tooling.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Ask shows "Service unreachable" | `launchctl list \| grep opencode-raycast`; restart from **Settings & Health** |
| Answers are empty | check the combo in **Models & Combos**; `curl -s 127.0.0.1:20128/v1/models` |
| `web_search` fails | `docker ps \| grep searxng`, then `npm run search:up` |
| New MCP server does not appear | **MCP Servers → Reload**, or restart the service |
| Extension not in Raycast | `npm run dev` must be running; dev builds land in `~/.config/raycast/extensions/omniroute-raycast` |
| `ray` version clash | use the local binary: `./node_modules/.bin/ray` |

## Known limits

- Only tools already in the working directory tree are reachable, and opencode refuses relative
  paths that escape it.
- The `ray develop` window must stay open for the dev install to keep updating.
- `~/.local/share/opencode/opencode.db` is currently **19 GB** (long-lived tool output and
  snapshots). Not touched by this extension, but worth pruning on its own.
