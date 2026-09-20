# テスト

実ブラウザ（Chromium）でアプリを操作し、PDFの中身まで検証します。

```bash
npm install                 # playwright と pdf-lib（検証用）
npx playwright install chromium
pip install Pillow
npm run fixtures            # test/fixtures/ にテスト画像を生成
npm run serve &             # http://127.0.0.1:8123 で配信
npm run build               # dist/photo-into-pdf.html（単一ファイル版）も検証対象
npm test
```

検証している内容（68項目）:

- 写真の読み込み、サムネイル生成、通し番号、エラー表示
- 重複検出（完全一致／見た目／書類の除外／誤検出しないこと）
- PDFの**中身**（ページ数・各ページの用紙サイズ・縦横の向き・縦横比）
- 画質プリセットでファイルサイズが変わること
- 並べ替え・削除・全消去、空状態のUI
- デスクトップ幅とiPhone幅の両方、ダークモード、横スクロールが出ないこと
- 単一HTMLファイル版が `file://` で動作しPDFを出力できること
- OCRが使えない環境で、固まらずに理由を表示すること

## 既知の環境依存

- **headless Chromium は `download` 属性の非ASCIIファイル名を無視します**
  （`テスト.pdf` → `download`）。実ブラウザでは日本語名で保存されるため、
  テスト側をASCII名にしています。アプリを変更しないでください。
- OCRの学習データはCDNから取得するため、外部へ出られない環境ではOCRテストは
  「エラーが正しく表示されること」の確認になります。
