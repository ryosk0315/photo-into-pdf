import { chromium } from "playwright";
import { readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PHOTOS = join(ROOT, "fixtures");
const DL = join(ROOT, "downloads");
const SHOTS = join(ROOT, "screenshots");
const REPO = join(ROOT, "..");
const BASE = process.env.BASE || "http://127.0.0.1:8123";
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const all = readdirSync(PHOTOS).sort().map((f) => join(PHOTOS, f));
let failures = [];
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failures.push(name + (extra ? " — " + extra : ""));
};

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

async function run(label, viewport, isMobile) {
  console.log(`\n===== ${label} =====`);
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });

  check("ライブラリが読み込まれた",
    await page.evaluate(() => typeof PDFLib !== "undefined" && typeof heic2any === "function" && typeof Sortable !== "undefined"));

  // --- 写真の追加 ---
  await page.setInputFiles("#file", all);
  await page.waitForFunction((n) => document.querySelectorAll("#grid .tile").length === n, all.length, { timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("overlay").hidden, null, { timeout: 60000 });
  check(`${all.length}枚すべて読み込まれた`, (await page.locator("#grid .tile").count()) === all.length);
  {
    const expectedNames = all.map((p) => basename(p));
    const actualNames = await page.evaluate(() => state.items.map((i) => i.name));
    check("並行処理で読み込んでも選択した順番のまま追加される（完了順に混ざらない）",
      JSON.stringify(actualNames) === JSON.stringify(expectedNames), actualNames.join(","));
  }
  check("エラー表示なし", await page.locator("#addErr").isHidden());
  check("サムネイルが表示されている",
    await page.evaluate(() => Array.from(document.querySelectorAll("#grid .tile img")).every((i) => i.complete && i.naturalWidth > 0)));
  check("番号が1..Nで振られている",
    await page.evaluate((n) => Array.from(document.querySelectorAll("#grid .tile .num")).map((e) => e.textContent).join(",") ===
      Array.from({ length: n }, (_, i) => i + 1).join(","), all.length));
  check("PDFボタンが有効になった", await page.locator("#make").isEnabled());
  check("写真があるとき並べ替えツールが見える", await page.locator("#gridTools").isVisible());

  // --- 見た目の重複チェック ---
  await page.click("#scanFast");
  await page.waitForSelector(".dgroup", { timeout: 20000 });
  const groups = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".dgroup")).map((g) => ({
      why: g.querySelector(".why").textContent.trim(),
      names: Array.from(g.querySelectorAll(".dstrip figure img")).map((i) => i.alt),
    })));
  console.log("    検出:", JSON.stringify(groups, null, 0));

  const exact = groups.find((g) => g.why.includes("完全に同じ"));
  check("完全一致を検出（scene04 と scene04-copy）",
    !!exact && exact.names.includes("scene04.jpg") && exact.names.includes("scene04-copy.jpg"),
    exact ? exact.names.join("+") : "未検出");

  const visual = groups.filter((g) => g.why.includes("見た目"));
  check("撮り直しの写真を検出（scene01 と scene01-retakeA）",
    visual.length === 1 && visual[0].names.includes("scene01.jpg") && visual[0].names.includes("scene01-retakeA.jpg"),
    JSON.stringify(visual.map((g) => g.names)));

  const DOCS = ["invoice.jpg", "invoice-retake.jpg", "receipt.jpg", "contract.jpg"];
  const visualNames = visual.flatMap((g) => g.names);
  check("書類を見た目で誤検出していない（別書類を同一視しない）",
    DOCS.every((d) => !visualNames.includes(d)), visualNames.join(","));

  const allNames = groups.flatMap((g) => g.names);
  check("無関係な写真を巻き込んでいない", !allNames.includes("scene05.jpg"), allNames.join(","));

  const noteText = await page.textContent("#dupResult");
  check("書類にはOCRを使うよう案内している",
    noteText.includes("書類らしき画像") && noteText.includes("内容でチェック"),
    noteText.slice(0, 60));
  check("書類の枚数を正しく数えている",
    await page.evaluate((n) => state.items.filter((i) => i.sig.isDocument).length === n, DOCS.length),
    await page.evaluate(() => state.items.filter((i) => i.sig.isDocument).map((i) => i.name).join(",")));
  check("写真を書類と誤分類していない",
    await page.evaluate(() => state.items.filter((i) => i.sig.isDocument).every((i) => !i.name.startsWith("scene"))));

  check("重複タイルに印がついている", (await page.locator("#grid .tile.dup").count()) >= 2);
  await page.screenshot({ path: join(SHOTS, `${label}.png`), fullPage: true });

  // --- A4モードでPDF ---
  const grab = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#make")]);
    const p = join(DL, name);
    await dl.saveAs(p);
    await page.waitForFunction(() => !state.busy, null, { timeout: 30000 });
    return { path: p, suggested: dl.suggestedFilename() };
  };

  await page.fill("#fname", "my-scan");
  const a4 = await grab("a4.pdf");
  check("ファイル名が反映される（my-scan.pdf）", a4.suggested === "my-scan.pdf", a4.suggested);
  // 注: headless Chromium は download属性の非ASCII名を無視する（実ブラウザでは日本語名も通る）
  let doc = await PDFDocument.load(readFileSync(a4.path));
  let sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
  check("A4: ページ数が写真の枚数と一致", doc.getPageCount() === all.length, `${doc.getPageCount()}ページ`);
  check("A4: 全ページがA4サイズ（縦or横）",
    sizes.every(([w, h]) => (w === 595 && h === 842) || (w === 842 && h === 595)), JSON.stringify(sizes));
  const srcLandscape = await page.evaluate(() => state.items.map((i) => i.w > i.h));
  check("A4: 横長写真だけ横向きページになっている",
    sizes.every(([w, h], i) => (w > h) === srcLandscape[i]),
    `横向き${sizes.filter(([w, h]) => w > h).length} / 期待${srcLandscape.filter(Boolean).length}`);

  // --- 写真ぴったりモード ---
  await page.click('#pageMode button[data-v="fit"]');
  check("ページ形の説明が切り替わった", (await page.textContent("#pageDesc")).includes("縦横比"));
  const fit = await grab("fit.pdf");
  doc = await PDFDocument.load(readFileSync(fit.path));
  sizes = doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
  check("ぴったり: ページ数が一致", doc.getPageCount() === all.length);
  check("ぴったり: 長辺が841.89ptに揃っている",
    sizes.every(([w, h]) => Math.abs(Math.max(w, h) - 841.89) < 0.5), JSON.stringify(sizes.map(([w, h]) => Math.round(Math.max(w, h)))));
  const srcRatios = await page.evaluate(() => state.items.map((i) => i.w / i.h));
  check("ぴったり: 各ページの縦横比が元写真と一致",
    sizes.every(([w, h], i) => Math.abs(w / h - srcRatios[i]) < 0.02),
    sizes.map(([w, h], i) => (w / h).toFixed(3) + "/" + srcRatios[i].toFixed(3)).join(" "));

  // --- 画質プリセット ---
  await page.click('#quality button[data-v="light"]');
  const light = await grab("light.pdf");
  await page.click('#quality button[data-v="high"]');
  const high = await grab("high.pdf");
  const sLight = readFileSync(light.path).length, sHigh = readFileSync(high.path).length;
  check("画質: 軽さ優先 < 高画質 のファイルサイズ", sLight < sHigh,
    `${(sLight / 1024 / 1024).toFixed(2)}MB < ${(sHigh / 1024 / 1024).toFixed(2)}MB`);

  // --- 並べ替え・削除 ---
  await page.click("#reverse");
  const firstAfterReverse = await page.locator("#grid .tile .name").first().textContent();
  check("逆順ボタンが効く", firstAfterReverse === all[all.length - 1].split("/").pop(), firstAfterReverse);
  await page.click("#sortName");
  const firstAfterSort = await page.locator("#grid .tile .name").first().textContent();
  check("ファイル名順ボタンが効く", firstAfterSort === "contract.jpg", firstAfterSort);
  await page.locator("#grid .tile .del").first().click();
  check("1枚削除できる", (await page.locator("#grid .tile").count()) === all.length - 1);
  check("削除で重複結果がリセットされる", (await page.locator(".dgroup").count()) === 0);

  const errorsBeforeOcr = consoleErrors.length;
  // OCR: この環境はCDNへ出られないため、静かに固まらず明示的なエラーが出ることを確認する
  page.on("dialog", (d) => d.accept());
  await page.click("#scanOcr");
  await page.waitForFunction(() => !state.busy, null, { timeout: 90000 });
  const ocrErrVisible = await page.locator("#scanErr").isVisible();
  const ocrErrText = ocrErrVisible ? await page.textContent("#scanErr") : "";
  check("OCRが使えないとき、固まらず理由を表示する",
    ocrErrVisible && ocrErrText.includes("内容チェックに失敗"), ocrErrText.slice(0, 80));
  check("OCR失敗後もボタン操作を再開できる", await page.locator("#scanFast").isEnabled());

  await page.click("#clear");
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 0, null, { timeout: 5000 });
  check("全消去できる", (await page.locator("#grid .tile").count()) === 0);
  check("空のときPDFボタンは無効", await page.locator("#make").isDisabled());
  check("空のとき並べ替えツールは隠れる", await page.locator("#gridTools").isHidden());
  check("空のとき重複チェック結果は消えている", (await page.locator("#dupResult").innerHTML()) === "");

  // OCR実行より前に出たエラーだけを見る（OCRのCDN取得失敗はこの環境固有）
  check("コンソールエラーなし", errorsBeforeOcr === 0, consoleErrors.slice(0, 3).join(" | "));
  check("横スクロールが発生していない",
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

  await page.screenshot({ path: join(SHOTS, `${label}-empty.png`), fullPage: false });
  await ctx.close();
}

await run("desktop", { width: 1280, height: 900 }, false);
await run("iphone", { width: 390, height: 844 }, true);

/* 読み込み中オーバーレイの表示とキャンセル操作の確認 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });

  // processFile (並行ワーカーが実際に呼ぶ関数) を人為的に遅くして、
  // キャンセル操作が間に合うようにする。並行処理は複数枚を一気に片付けて
  // しまうため、ファイル数も水増しして十分な時間を確保する。
  await page.evaluate(() => {
    const real = processFile;
    window.processFile = async (f) => {
      await new Promise((r) => setTimeout(r, 150));
      return real(f);
    };
  });
  const manyFiles = [...all, ...all, ...all];

  await page.setInputFiles("#file", manyFiles);

  await page.waitForFunction(() => !document.getElementById("overlay").hidden, null, { timeout: 5000 });
  check("読み込み中はオーバーレイが表示される", true);
  check("読み込み中はキャンセルボタンが見える", await page.locator("#overlayCancel").isVisible());
  const countText = await page.textContent("#overlayCount");
  check(`オーバーレイに枚数(N / ${manyFiles.length} 枚)が出る`,
    new RegExp(`/\\s*${manyFiles.length}\\s*枚`).test(countText), countText);

  await page.click("#overlayCancel");
  await page.waitForFunction(() => document.getElementById("overlay").hidden, null, { timeout: 10000 });
  const addedCount = await page.evaluate(() => state.items.length);
  check("キャンセルすると途中で読み込みが止まる",
    addedCount > 0 && addedCount < manyFiles.length, `${addedCount}/${manyFiles.length}`);
  const errText = await page.textContent("#addErr");
  check("キャンセルした旨が表示される", errText.includes("キャンセルしました"), errText);
  check("キャンセル通知はエラー色ではなく控えめな表示になる",
    await page.evaluate(() => document.getElementById("addErr").classList.contains("info")));

  // PDF作成中はキャンセルボタンを出さない(作成途中で止められないため)
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    (async () => {
      await page.waitForFunction(() => !state.busy, null, { timeout: 5000 });
      await page.click("#make");
      await page.waitForFunction(() => !document.getElementById("overlay").hidden, null, { timeout: 5000 });
    })(),
  ]);
  check("PDF作成中はキャンセルボタンを出さない",
    await page.evaluate(() => document.getElementById("overlayCancel").hidden));
  await page.waitForFunction(() => document.getElementById("overlay").hidden, null, { timeout: 15000 });

  await ctx.close();
}

/* ダークモード表示の確認 */
{
  const ctx = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#file", all.slice(0, 3));
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3, null, { timeout: 30000 });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("ダークモードで背景が暗い", bg !== "rgb(246, 247, 249)" && bg !== "rgba(0, 0, 0, 0)", bg);
  await page.screenshot({ path: join(SHOTS, "dark.png") });
  await ctx.close();
}

/* 単一HTMLファイル版が file:// で動くか */
{
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("file://" + join(REPO, "dist", "photo-into-pdf.html"));
  await page.setInputFiles("#file", all.slice(0, 3));
  await page.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 3, null, { timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#make")]);
  const p = join(DL, "standalone.pdf");
  await dl.saveAs(p);
  const d = await PDFDocument.load(readFileSync(p));
  check("単一HTML版が file:// で動きPDFを出力できる", d.getPageCount() === 3 && errs.length === 0, errs.join("|"));
  await ctx.close();
}

await browser.close();

console.log("\n==================================================");
if (failures.length) {
  console.log(`失敗 ${failures.length}件:`);
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("すべて成功");
