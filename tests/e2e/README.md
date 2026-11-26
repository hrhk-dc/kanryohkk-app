# 完了報告アプリの確認テスト（Playwright）

変更した場所だけを確認するためのテスト。フルテストではない。Firebase は偽物に置き換え、API は応答を差し替える。

## 実行の仕方（ローカル）
1. 公開フォルダをローカルで配る：`python3 -m http.server 8767 --directory public`
2. 別の端末で：`node tests/e2e/integration-test.js http://localhost:8767`（切り替え・訪問リストの共有）
   - `node tests/e2e/menu-test.js http://localhost:8767`（三本線メニュー）
   - `node tests/e2e/visit-button-test.js http://localhost:8767`（訪問リストの Maplist ボタン）
3. スクリーンショットは `SHOTS` の場所（未指定なら /tmp）に保存される。

Playwright は、コンテナ内に入っているものを `require('playwright')` で使う（インストールし直さない）。
