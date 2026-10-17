#!/usr/bin/env node
/**
 * mcp-searxng — minimal, dependency-free MCP server (stdio) exposing SearXNG
 * as a tool surface for agents.
 *
 * Tools:
 *   web_search  — query SearXNG JSON API, returns ranked results
 *   web_fetch   — fetch a URL and return readable plain text
 *
 * Env:
 *   SEARXNG_URL   base url of the SearXNG instance (default http://127.0.0.1:8888)
 *   SEARXNG_ENGINES optional comma separated engine list (default: engine default)
 *   FETCH_MAX_CHARS default character budget for web_fetch (default 12000)
 */

const SEARXNG_URL = (process.env.SEARXNG_URL || "http://127.0.0.1:8888").replace(/\/+$/, "");
const ENGINES = (process.env.SEARXNG_ENGINES || "").trim();
const FETCH_MAX_CHARS = Number(process.env.FETCH_MAX_CHARS || 12000);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the live web through a self-hosted SearXNG metasearch instance. Use it for current events, facts you are unsure about, docs, prices, weather, news, or anything published after your training data. Returns ranked results with title, url and a content snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, natural language or keywords." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Max results to return (default 8)." },
        language: { type: "string", description: "Language code such as pl, en. Default: auto." },
        time_range: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Restrict results to a recent time range.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch a URL and return its readable text content (HTML stripped, nav and scripts removed). Use after web_search to read a promising page in full.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch." },
        max_chars: { type: "integer", minimum: 500, maximum: 60000, description: "Character budget (default 12000)." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

/* ----------------------------- text helpers ----------------------------- */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, code) ? ENTITIES[code] : m;
  });
}

function htmlToText(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<h([1-6])[^>]*>/gi, (m, n) => "\n" + "#".repeat(Number(n)) + " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v\u00a0]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return s.trim();
}

function pickTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

function pickMain(html) {
  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]+(?:id|class)="[^"]*(?:content|post|entry|article|markdown|prose)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const re of candidates) {
    const found = [...html.matchAll(re)].map((m) => m[1]).filter((x) => x && x.length > 400);
    if (found.length) return found.join("\n\n");
  }
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

/* ------------------------------ web search ------------------------------ */

async function webSearch({ query, limit = 8, language, time_range }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const params = new URLSearchParams({ q: String(query), format: "json", safesearch: "0" });
  if (language) params.set("language", language);
  if (time_range) params.set("time_range", time_range);
  if (ENGINES) params.set("engines", ENGINES);

  const res = await fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`SearXNG responded ${res.status} ${res.statusText}`);
  const data = await res.json();
  const results = (data.results || []).slice(0, Math.min(Number(limit) || 8, 25));
  if (!results.length) return `No results for: ${query}`;

  const lines = [`${results.length} results for "${query}" (via SearXNG${ENGINES ? ` [${ENGINES}]` : ""}):`, ""];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title || "(no title)"}`);
    lines.push(`   ${r.url}`);
    const snippet = (r.content || r.publishedDate || "").replace(/\s+/g, " ").trim();
    if (snippet) lines.push(`   ${snippet.slice(0, 400)}`);
    if (r.engines?.length) lines.push(`   engines: ${r.engines.join(", ")}`);
    lines.push("");
  });
  const answers = data.answers || [];
  const infoboxes = data.infoboxes || [];
  if (answers.length || infoboxes.length) {
    lines.push("Direct answers:");
    answers.forEach((a) => lines.push(`- ${String(a).replace(/\s+/g, " ")}`));
    infoboxes.forEach((b) => {
      if (b?.content) lines.push(`- ${b.infobox || ""}: ${String(b.content).replace(/\s+/g, " ").slice(0, 400)}`);
    });
  }
  return lines.join("\n").trim();
}

/* ------------------------------- web fetch ------------------------------ */

async function webFetch({ url, max_chars }) {
  if (!/^https?:\/\//i.test(url || "")) throw new Error("url must start with http:// or https://");
  const budget = Math.min(Number(max_chars) || FETCH_MAX_CHARS, 60000);

  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);

  const ctype = res.headers.get("content-type") || "";
  const raw = await res.text();
  const title = pickTitle(raw);
  const isHtml = ctype.includes("html") || /<html|<body|<div/i.test(raw.slice(0, 2000));
  let text = isHtml ? htmlToText(pickMain(raw)) : raw.trim();

  const truncated = text.length > budget;
  if (truncated) text = text.slice(0, budget);

  const head = [`# ${title || url}`, `Source: ${url}`, ""].join("\n");
  return head + text + (truncated ? `\n\n[... truncated at ${budget} characters]` : "");
}

/* ------------------------------- MCP glue ------------------------------- */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mcp-searxng", version: "1.0.0" },
      instructions: `Live web access through SearXNG at ${SEARXNG_URL}. Use web_search for fresh facts, then web_fetch to read a promising result in full.`,
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const text = name === "web_search" ? await webSearch(args) : name === "web_fetch" ? await webFetch(args) : null;
      if (text === null) return fail(id, -32602, `Unknown tool: ${name}`);
      return ok(id, { content: [{ type: "text", text }], isError: false });
    } catch (err) {
      return ok(id, {
        content: [{ type: "text", text: `${name} failed: ${err?.message || String(err)}` }],
        isError: true,
      });
    }
  }

  if (id !== undefined && id !== null) fail(id, -32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(msg)).catch((err) => {
      if (msg?.id !== undefined) fail(msg.id, -32603, err?.message || String(err));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
