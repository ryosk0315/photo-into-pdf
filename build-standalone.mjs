#!/usr/bin/env node
/**
 * vendor/ のライブラリを index.html に埋め込み、
 * 1ファイルで完結する dist/photo-into-pdf.html を作る。
 *
 *   node build-standalone.mjs
 *
 * 出来上がったHTMLはそのまま人に渡せる（ダブルクリックで開くだけで動く）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, "dist", "photo-into-pdf.html");

let html = readFileSync(join(root, "index.html"), "utf8");

const tag = /<script src="(vendor\/[^"]+)"><\/script>/g;
let count = 0;
html = html.replace(tag, (_m, src) => {
  const code = readFileSync(join(root, src), "utf8");
  count++;
  // </script> がライブラリ内の文字列に現れてもHTMLが壊れないようにする
  return `<script>/* ${src} */\n${code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`;
});

if (count === 0) {
  console.error("vendor/ のscriptタグが見つかりませんでした。index.html を確認してください。");
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");
console.log(`${count}個のライブラリを埋め込みました → dist/photo-into-pdf.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
