import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const requiredStatic = [
  "index.html",
  "app.js",
  "broker-v183.js",
  "dashboard-pad.js",
  "validation-v110.js",
  "calibration-ui-v1102.js",
  "volume-audit-ui-v1104.js",
  "volume-reliability-ui-v1105.js",
  "app.css",
  "sw.js",
  "icon.svg",
  "kai-trad-logo.png",
  "pwa-icon-192.png",
  "pwa-icon-512.png",
  "manifest.webmanifest",
];

test("all PWA build inputs exist", async () => {
  await Promise.all(requiredStatic.map((file) => access(file)));
});

test("manifest.webmanifest is valid and installable", async () => {
  const raw = await readFile("manifest.webmanifest", "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.name, "KAI TRAD");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  assert.ok(manifest.icons.some((icon) => String(icon.src || "").endsWith(".png")));
});
