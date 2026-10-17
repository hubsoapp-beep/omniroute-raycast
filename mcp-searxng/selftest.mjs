#!/usr/bin/env node
/**
 * Spawns mcp-searxng over stdio and exercises the MCP handshake + both tools.
 * Usage: node selftest.mjs ["query"]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const query = process.argv[2] || "pogoda kraków";

const child = spawn(process.execPath, [join(here, "index.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

const seen = [];
let buf = "";
child.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) seen.push(JSON.parse(line));
  }
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
const waitFor = (pred, ms = 30000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const hit = seen.find(pred);
      if (hit) {
        clearInterval(iv);
        resolve(hit);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error("timeout waiting for response"));
      }
    }, 100);
  });

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
const init = await waitFor((m) => m.id === 1);
console.log("initialize:", init.result?.serverInfo, "| protocol", init.result?.protocolVersion);

send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const list = await waitFor((m) => m.id === 2);
console.log("tools:", list.result.tools.map((t) => t.name).join(", "));

send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "web_search", arguments: { query, limit: 3 } } });
const search = await waitFor((m) => m.id === 3, 40000);
console.log("--- web_search ---");
console.log(search.result.content[0].text.slice(0, 700));

const firstUrl = (search.result.content[0].text.match(/https?:\/\/\S+/) || [])[0];
if (firstUrl) {
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "web_fetch", arguments: { url: firstUrl, max_chars: 1200 } } });
  const fetched = await waitFor((m) => m.id === 4, 40000);
  console.log("--- web_fetch", firstUrl, "---");
  console.log(fetched.result.content[0].text.slice(0, 700));
}

child.kill();
console.log("\nSELFTEST OK");
