// Bundle the extension into ./extension (committed, so it can be loaded
// unpacked straight from a download of the repo).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const out = "extension";
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { page: "src/extension/page.ts", content: "src/extension/content.ts" },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome110",
  minify: false,
  legalComments: "none",
  logLevel: "info",
});

const pkg = JSON.parse(await (await import("node:fs/promises")).readFile("package.json", "utf8"));
const manifest = {
  manifest_version: 3,
  name: "Poker Bot (advisor)",
  version: pkg.version,
  description: "Reads your pokerpatio table and suggests plays. Never clicks or acts for you.",
  permissions: ["storage"],
  icons: { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" },
  action: { default_title: "Poker Bot: open pokerpatio.com and the panel appears on the table", default_icon: { 16: "icons/icon16.png", 32: "icons/icon32.png" } },
  content_scripts: [
    {
      matches: ["https://pokerpatio.com/*", "https://*.pokerpatio.com/*"],
      js: ["page.js"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
    },
    {
      matches: ["https://pokerpatio.com/*", "https://*.pokerpatio.com/*"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
    },
  ],
};
mkdirSync(`${out}/icons`, { recursive: true });
for (const size of [16, 32, 48, 128]) copyFileSync(`assets/icons/icon${size}.png`, `${out}/icons/icon${size}.png`);
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${out}/ (load it via chrome://extensions → Load unpacked)`);
