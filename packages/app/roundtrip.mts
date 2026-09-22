
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { parseScript } from "@vnmaker/content";
import { buildExportBundle } from "./src/studio/exportBundle.ts";
import { readProjectBundle } from "./src/studio/restoreBundle.ts";

const appRoot = "/home/main/z-project/vnmaker/packages/app";
const game = parseScript(JSON.parse(readFileSync("/tmp/deepsea-game.json","utf8")));

const result = await build({
  configFile:false, root:appRoot, publicDir:false, base:"./", logLevel:"warn",
  plugins:[react()],
  resolve:{ alias:{ "@vnmaker/content": resolve(appRoot,"src/export/export-content.ts") } },
  build:{ target:"es2022", write:false, emptyOutDir:false, cssCodeSplit:false, sourcemap:false, assetsInlineLimit:0,
    rollupOptions:{ input: resolve(appRoot,"src/export/export-player.tsx"), output:{ entryFileNames:"player-[hash].js", assetFileNames:"[name]-[hash][extname]", inlineDynamicImports:true } } },
});
const outputs = Array.isArray(result)?result:[result];
const rtFiles = new Map();
for (const o of outputs) for (const item of o.output) rtFiles.set(item.fileName, Buffer.from(item.type==="chunk"?item.code:item.source));
const entry = [...rtFiles.keys()].find(p=>/^player-.*\.js$/.test(p));
const stylesheets = [...rtFiles.keys()].filter(p=>p.endsWith(".css"));
const manifest = { version:1, entry, stylesheets, files:[...rtFiles].map(([path,bytes])=>({path,size:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex")})) };
rtFiles.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
console.log("runtime built:", rtFiles.size, "files");

const fetcher = async (url) => {
  const path = url.split("?")[0];
  if (path.startsWith("/export-runtime/")) {
    const b = rtFiles.get(path.slice("/export-runtime/".length));
    if (!b) return { ok:false, status:404 };
    return { ok:true, status:200, json:async()=>JSON.parse(b.toString()), arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) };
  }
  const fp = resolve(appRoot, "public", "."+path);
  try { const b = readFileSync(fp); return { ok:true, status:200, arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) }; }
  catch { return { ok:false, status:404 }; }
};

const { blob, filename, fileCount, projectNamespace } = await buildExportBundle(game, { fetcher });
console.log("BUNDLE:", filename, "| files:", fileCount, "| ns:", projectNamespace, "| bytes:", blob.size);
const { script: reimported, files } = await readProjectBundle(blob);
const re = parseScript(reimported);
console.log("REIMPORTED:", re.scenes.length, "scenes,", re.scenes.reduce((s,x)=>s+x.lines.length,0), "lines,", re.characters.length, "chars,", re.endings?.length ?? "?", "endings");
console.log("ROUNDTRIP:", re.scenes.length===game.scenes.length && re.title===game.title ? "OK" : "MISMATCH");
