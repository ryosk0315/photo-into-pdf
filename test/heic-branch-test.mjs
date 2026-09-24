import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:8123";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

const browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}) });
const page = await browser.newPage();
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });

const failed = [];
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed.push(name);
};

// addOneFile の分岐: HEICファイルに対し、
//   1) decodeImage(file) がネイティブに成功する場合 → heic2anyを呼ばない・sourceは元ファイルのまま
//   2) decodeImage(file) が失敗する場合            → heic2anyで変換し、その結果をsourceにする
// をモックで検証する（実HEICバイナリを用意しなくても分岐ロジック自体は検証できる）。
const result = await page.evaluate(async () => {
  const out = {};

  function makeHeicFile(name) {
    return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/heic" });
  }

  const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDoKKKK+XPFP//Z";
  const tinyBlob = await (await fetch("data:image/jpeg;base64," + TINY_JPEG_B64)).blob();
  const realDecodeImage = decodeImage;
  const realHeic2any = window.heic2any;

  // --- ケース1: ネイティブデコード成功 ---
  {
    let heicCalls = 0;
    window.heic2any = async () => { heicCalls++; return new Blob([new Uint8Array([9])], { type: "image/jpeg" }); };
    window.decodeImage = async (blob) => {
      // ネイティブ成功を模擬: どんなblobが来ても実物の小さいJPEGとしてデコードする
      return await realDecodeImage(tinyBlob);
    };

    const before = state.items.length;
    await addOneFile(makeHeicFile("native-ok.heic"));
    const item = state.items[state.items.length - 1];
    out.case1_added = state.items.length === before + 1;
    out.case1_heicCallsSkipped = heicCalls === 0;
    out.case1_sourceIsOriginalFile = item && item.source instanceof File && item.source.name === "native-ok.heic";
  }

  // --- ケース2: ネイティブデコード失敗 → heic2anyにフォールバック ---
  {
    let heicCalls = 0;
    window.heic2any = async ({ blob }) => { heicCalls++; return tinyBlob.slice(0, tinyBlob.size, "image/jpeg"); };
    let call = 0;
    window.decodeImage = async (blob) => {
      call++;
      if (call === 1) throw new Error("ネイティブデコード失敗を模擬");
      return await realDecodeImage(blob);
    };

    const before = state.items.length;
    await addOneFile(makeHeicFile("native-fail.heic"));
    const item = state.items[state.items.length - 1];
    out.case2_added = state.items.length === before + 1;
    out.case2_heicCallsMade = heicCalls === 1;
    out.case2_sourceIsConvertedBlob = item && !(item.source instanceof File) && item.source.type === "image/jpeg";
  }

  window.decodeImage = realDecodeImage;
  window.heic2any = realHeic2any;

  // 後始末（他のテストに影響しないようクリア）
  for (const it of state.items) URL.revokeObjectURL(it.thumbUrl);
  state.items = [];
  render();

  return out;
});

check("ケース1: 写真が追加された", result.case1_added);
check("ケース1: ネイティブ成功時はheic2anyを呼ばない", result.case1_heicCallsSkipped);
check("ケース1: sourceは元のHEICファイルのまま(無駄な変換をしていない)", result.case1_sourceIsOriginalFile);
check("ケース2: 写真が追加された", result.case2_added);
check("ケース2: ネイティブ失敗時はheic2anyで1回だけ変換する", result.case2_heicCallsMade);
check("ケース2: sourceはheic2anyが返した変換後Blobになる", result.case2_sourceIsConvertedBlob);

await browser.close();

console.log("\n==================================================");
if (failed.length) {
  console.log(`失敗 ${failed.length}件`);
  process.exit(1);
}
console.log("すべて成功");
