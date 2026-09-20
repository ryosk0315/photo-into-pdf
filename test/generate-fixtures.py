#!/usr/bin/env python3
"""テスト用の画像を生成する。

  pip install Pillow
  python3 test/generate-fixtures.py

test/fixtures/ に以下を作る:
  scene01.jpg / scene01-retakeA.jpg  … 同じ被写体を撮り直したペア（見た目で検出できるべき）
  scene04.jpg / scene04-copy.jpg     … バイト単位で同一（完全一致で検出できるべき）
  scene05.jpg                        … 無関係な写真（どのグループにも入ってはいけない）
  invoice.jpg / invoice-retake.jpg   … 同じ書類の撮り直し
  receipt.jpg / contract.jpg         … 別々の書類（誤って同一視してはいけない）
"""
import os, random, shutil
from PIL import Image, ImageDraw, ImageEnhance

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)


def scene(path, seed, w=1400, h=1050):
    """カラフルな「写真」。ハッシュにとっては最悪条件のランダムテクスチャ。"""
    random.seed(seed)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for i in range(0, h, 6):
        d.rectangle([0, i, w, i + 6],
                    fill=(random.randint(20, 230), random.randint(20, 230), random.randint(20, 230)))
    for _ in range(30):
        x0 = random.randint(0, w - 300); y0 = random.randint(0, h - 300)
        d.ellipse([x0, y0, x0 + random.randint(80, 320), y0 + random.randint(80, 320)],
                  fill=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
    im.save(path, "JPEG", quality=90)


def retake(src, path, shift, bright, rot, quality, noise):
    """撮り直しを模した加工：ずれ・明るさ・回転・再圧縮・ノイズ。"""
    im = Image.open(src).rotate(rot, resample=Image.BICUBIC, fillcolor=(128, 128, 128))
    w, h = im.size
    im = im.crop((shift[0], shift[1], w - 8 + shift[0], h - 8 + shift[1])).resize((w, h))
    im = ImageEnhance.Brightness(im).enhance(bright)
    px = im.load(); random.seed(noise)
    for _ in range(w * h // 40):
        x0 = random.randrange(w); y0 = random.randrange(h); v = random.randint(-18, 18)
        r, g, b = px[x0, y0]
        px[x0, y0] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    im.save(path, "JPEG", quality=quality)


def document(path, title, lines, w=1200, h=1600, quality=92, shift=(0, 0), bright=1.0, noise=0):
    """白い紙に文字が書かれた「書類」。"""
    im = Image.new("RGB", (w, h), (252, 251, 248))
    d = ImageDraw.Draw(im)
    ox, oy = shift
    d.rectangle([60 + ox, 60 + oy, w - 60 + ox, h - 60 + oy], outline=(170, 170, 170), width=3)
    d.text((110 + ox, 120 + oy), title, fill=(15, 15, 15))
    y = 220 + oy
    for ln in lines:
        d.text((110 + ox, y), ln, fill=(35, 35, 35)); y += 44
    if noise:
        px = im.load(); random.seed(noise)
        for _ in range(w * h // 60):
            x0 = random.randrange(w); y0 = random.randrange(h); v = random.randint(-14, 14)
            r, g, b = px[x0, y0]
            px[x0, y0] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    if bright != 1.0:
        im = ImageEnhance.Brightness(im).enhance(bright)
    im.save(path, "JPEG", quality=quality)


scene(f"{OUT}/scene01.jpg", 13)
scene(f"{OUT}/scene04.jpg", 52)
scene(f"{OUT}/scene05.jpg", 65)
retake(f"{OUT}/scene01.jpg", f"{OUT}/scene01-retakeA.jpg", (10, 6), 1.00, 0.0, 75, 1)
shutil.copyfile(f"{OUT}/scene04.jpg", f"{OUT}/scene04-copy.jpg")

invoice = ["契約番号 AB-1029-77", "氏名 山田 太郎", "住所 東京都渋谷区1-2-3",
           "品目 コンサルティング費", "金額 128,400円", "支払期限 2026年9月30日"]
contract = ["第1条 本契約は甲乙間の業務委託に関する", "第2条 委託期間は2026年4月1日から1年間とする",
            "第3条 報酬は月額200,000円とし翌月末に支払う", "第4条 成果物の著作権は甲に帰属するものとする",
            "第5条 秘密保持義務は契約終了後も3年間存続する", "第6条 中途解約は30日前の書面通知を要する",
            "第7条 反社会的勢力の排除に関する条項を含む", "第8条 準拠法は日本法とし東京地裁を専属管轄とする"]
document(f"{OUT}/invoice.jpg", "請求書", invoice)
document(f"{OUT}/invoice-retake.jpg", "請求書", invoice, shift=(14, 9), bright=1.08, noise=3, quality=68)
document(f"{OUT}/receipt.jpg", "領収書", ["受領番号 ZZ-5", "品目 事務用品", "金額 3,200円"])
document(f"{OUT}/contract.jpg", "業務委託契約書", contract)

for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
