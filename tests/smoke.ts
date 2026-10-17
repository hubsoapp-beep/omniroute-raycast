/**
 * End-to-end smoke test for the extension's opencode client (no Raycast UI).
 *
 *   npx esbuild tests/smoke.ts --bundle --platform=node --format=esm \
 *     --outfile=tests/smoke.mjs --external:@raycast/api && node tests/smoke.mjs
 *
 * Covers: service connect, agents, models, session create with guarded
 * permissions, SSE streaming of text, tool-call events, the permission
 * ask/reply gate and session cleanup.
 */
import { OpenCode, type OcEvent } from "../src/lib/opencode";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const guarded: { action: string; resource: string; effect: "ask" | "allow" | "deny" }[] = [
  { action: "shell", resource: "*", effect: "ask" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "write", resource: "*", effect: "ask" },
];

const client = await OpenCode.connect();
const info = await client.info();
check("service reachable", Boolean(info.version), `opencode ${info.version} pid ${info.pid}`);

const [agents, models] = await Promise.all([client.agents(), client.models()]);
check("agents listed", agents.length > 0, agents.map((a) => a.id).join(", "));
const omni = models.filter((m) => m.providerID === "omniroute");
const combos = omni.filter((m) => !m.id.includes("/"));
check("omniroute models", omni.length > 0, `${omni.length} models, ${combos.length} combos`);
check("combo Free Stack present", combos.some((m) => m.id === "Free Stack"), combos.map((m) => m.id).join(", "));

const combo = combos.some((m) => m.id === "Free Stack") ? "Free Stack" : combos[0]?.id;
if (!combo) throw new Error("no OmniRoute combos available");
console.log(`\n— using combo: ${combo}\n`);

const session = await client.createSession({
  title: "raycast smoke test",
  agent: "build",
  model: { id: combo, providerID: "omniroute" },
  directory: "/private/var/folders/36/801d1fx541991s5_dn7b6_wr0000gn/T/opencode",
  permissions: guarded,
});
check("session created", session.id.startsWith("ses_"), session.id);

/* ---------------------------- streaming turn ----------------------------- */

const events: OcEvent[] = [];
const controller = new AbortController();
let permission: { id: string; action: string; resources: string[] } | undefined;
let textBuffer = "";
let sawTool = false;
let sawExecutionEnd = false;
let phase = 1;

const streamTask = (async () => {
  for await (const event of client.streamEvents(controller.signal)) {
    if (event.data?.sessionID && event.data.sessionID !== session.id) continue;
    events.push(event);
    switch (event.type) {
      case "session.text.delta":
        textBuffer += event.data.delta ?? "";
        break;
      case "session.tool.input.started":
        sawTool = true;
        break;
      case "permission.asked":
        permission = { id: event.data.id, action: event.data.action, resources: event.data.resources };
        break;
      case "session.execution.succeeded":
      case "session.execution.failed":
        sawExecutionEnd = true;
        break;
      default:
        break;
    }
  }
})();

await new Promise((r) => setTimeout(r, 500));
await client.prompt(session.id, "Reply with exactly: SMOKE-OK");
await waitFor(() => textBuffer.includes("SMOKE-OK") && sawExecutionEnd, 120000);
check("streamed text answer", textBuffer.includes("SMOKE-OK"), JSON.stringify(textBuffer.slice(0, 80)));
check("execution finished", sawExecutionEnd);

/* ------------------------- permissions gate (HITL) ----------------------- */

textBuffer = "";
sawExecutionEnd = false;
permission = undefined;
phase = 2;
await client.prompt(session.id, "Use the bash tool to run exactly: echo smoke-tool");
await waitFor(() => permission !== undefined, 120000);
check("permission asked for shell", permission?.action === "shell", permission?.resources?.join(", "));

const pending = permission ? await client.pendingPermissions(session.id) : [];
check("pending permission listed", pending.some((p) => p.id === permission?.id), `${pending.length} pending`);

if (permission) {
  await client.replyPermission(session.id, permission.id, "reject");
  await waitFor(() => sawExecutionEnd, 120000);
  const after = await client.messages(session.id);
  const assistant = [...after].reverse().find((m) => m.type === "assistant");
  const ranAnyway = JSON.stringify(assistant?.content ?? []).includes("smoke-tool\n");
  check("deny stopped the tool", !ranAnyway, `finish=${assistant?.finish}`);
}

check("tool events observed", sawTool);

/* -------------------------------- cleanup -------------------------------- */

controller.abort();
await streamTask.catch(() => undefined);
await client.deleteSession(session.id).catch(() => undefined);
const remaining = await client.sessions(60);
check("session deleted", !remaining.some((s) => s.id === session.id));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (${events.length} events)`);
process.exit(failed.length ? 1 : 0);

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
  return true;
}
