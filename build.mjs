import { mkdir, rm, copyFile, readFile } from "node:fs/promises";

const staticFiles = [
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

const manifestRaw = await readFile("manifest.webmanifest", "utf8");
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (error) {
  throw new Error(`manifest.webmanifest is invalid JSON: ${error.message}`);
}
for (const field of ["name", "start_url", "scope", "display", "icons"]) {
  if (manifest[field] == null || (field === "icons" && !Array.isArray(manifest.icons))) {
    throw new Error(`manifest.webmanifest missing required field: ${field}`);
  }
}
if (!manifest.icons.length) throw new Error("manifest.webmanifest requires at least one icon");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of staticFiles) await copyFile(file, `dist/${file}`);
console.log(`KAI TRAD build ready: ${staticFiles.length} static assets -> dist/ • manifest validated`);
