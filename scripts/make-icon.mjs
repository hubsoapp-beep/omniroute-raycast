#!/usr/bin/env node
/**
 * Generates assets/icon.png (512x512) — no dependencies: raw RGBA buffer,
 * zlib deflate, hand-built PNG chunks. Motif: a router with one input and
 * three routed paths (OmniRoute -> combos -> answers).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const SS = 3; // supersampling factor

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "assets", "icon.png");

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// rounded-square mask so the icon reads as an app tile on any background
function tileMask(x, y) {
  const m = SIZE * 0.06; // margin
  const r = SIZE * 0.22; // corner radius
  const x0 = m,
    y0 = m,
    x1 = SIZE - m,
    y1 = SIZE - m;
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const d = Math.hypot(x - cx, y - cy);
  return clamp01((r - d) / 1.2);
}

// ---- geometry ------------------------------------------------------------
const input = { x: SIZE * 0.20, y: SIZE * 0.5 };
const hub = { x: SIZE * 0.50, y: SIZE * 0.5 };
const outs = [
  { x: SIZE * 0.81, y: SIZE * 0.27 },
  { x: SIZE * 0.81, y: SIZE * 0.5 },
  { x: SIZE * 0.81, y: SIZE * 0.73 },
];

function distToSegment(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = px - a.x;
  const wy = py - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp01((wx * vx + wy * vy) / len2);
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}

// quadratic bezier sample
function bezierPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function distToBezier(px, py, p0, p1, p2, samples = 48) {
  let best = Infinity;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const cur = bezierPoint(p0, p1, p2, i / samples);
    best = Math.min(best, distToSegment(px, py, prev, cur));
    prev = cur;
  }
  return best;
}

const BG_TOP = [14, 20, 36];
const BG_BOTTOM = [8, 11, 22];
const ACCENT = [76, 154, 255];
const ACCENT2 = [34, 211, 238];
const NODE = [236, 245, 255];

function render(scale) {
  const buf = new Float32Array(SIZE * SIZE * 4);
  const S = SIZE * scale;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale;

      // background: vertical gradient + soft accent glow behind the hub
      let color = mix(BG_TOP, BG_BOTTOM, clamp01(y / SIZE));
      const glow = Math.exp(-(Math.hypot(x - hub.x, y - hub.y) ** 2) / (2 * (SIZE * 0.30) ** 2));
      color = mix(color, mix(ACCENT, ACCENT2, clamp01((x - hub.x) / SIZE + 0.5)), 0.42 * glow);
      const glow2 = Math.exp(-(Math.hypot(x - input.x * 0.6, y - SIZE * 0.14) ** 2) / (2 * (SIZE * 0.42) ** 2));
      color = mix(color, ACCENT2, 0.10 * glow2);

      // routing lines: input -> hub
      const lw = SIZE * 0.030;
      const lineIn = distToSegment(x, y, input, hub);
      const inAlpha = clamp01((lw - lineIn) / 1.4);

      // hub -> outputs (curved)
      const curveAlpha = Math.max(
        ...outs.map((o, i) => {
          const ctrl = { x: hub.x + SIZE * 0.13, y: lerp(hub.y, o.y, i === 1 ? 0.5 : 0.78) };
          return clamp01((lw - distToBezier(x, y, hub, ctrl, o)) / 1.4);
        }),
      );

      const trace = Math.max(inAlpha, curveAlpha);
      if (trace > 0) {
        const grad = clamp01((x - input.x) / (outs[1].x - input.x));
        color = mix(color, mix(ACCENT, ACCENT2, grad), trace);
      }

      // nodes
      const nodes = [input, hub, ...outs];
      nodes.forEach((n, i) => {
        const R = i === 1 ? SIZE * 0.062 : SIZE * 0.050;
        const d = Math.hypot(x - n.x, y - n.y);
        const a = clamp01((R - d) / 1.4);
        if (a > 0) color = mix(color, NODE, a);
        const ring = Math.abs(d - R * 1.65);
        const ra = clamp01((SIZE * 0.007 - ring) / 1.2) * 0.55;
        if (ra > 0) color = mix(color, ACCENT2, ra);
      });

      const a3 = tileMask(x, y);
      const idx = (py * SIZE + px) * 4;
      // accumulate in float buffer at output resolution
      const ox = Math.floor(px / scale);
      const oy = Math.floor(py / scale);
      const oidx = (oy * SIZE + ox) * 4;
      buf[oidx] += color[0];
      buf[oidx + 1] += color[1];
      buf[oidx + 2] += color[2];
      buf[oidx + 3] += a3 * 255;
    }
  }

  // downsample
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const n = scale * scale;
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgba[i * 4] = Math.round(clamp01(buf[i * 4] / n / 255) * 255);
    rgba[i * 4 + 1] = Math.round(clamp01(buf[i * 4 + 1] / n / 255) * 255);
    rgba[i * 4 + 2] = Math.round(clamp01(buf[i * 4 + 2] / n / 255) * 255);
    rgba[i * 4 + 3] = Math.round(clamp01(buf[i * 4 + 3] / n / 255) * 255);
  }
  return rgba;
}

const rgba = render(SS);

// ---- PNG encoding --------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcTable = chunk.table || (chunk.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < body.length; i++) crc = crcTable[(crc ^ body[i]) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ -1) >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// raw scanlines with filter byte 0
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${SIZE}x${SIZE})`);
