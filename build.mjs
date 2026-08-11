import { mkdir, rm, copyFile } from "node:fs/promises";

const staticFiles = [
  "index.html",
  "app.js",
  "app.css",
  "sw.js",
  "icon.svg",
  "kai-trad-logo.png",
  "manifest.webmanifest",
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of staticFiles) await copyFile(file, `dist/${file}`);
console.log(`KAI TRAD build ready: ${staticFiles.length} static assets -> dist/`);
