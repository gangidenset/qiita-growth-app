# Qiita Growth アプリ（スマホ用 PWA）

スマホ・PC から、記事の確認（プレビュー・品質チェック）・承認・依頼ができるアプリ。承認すると GitHub Actions が Qiita に自動で投稿する。
画面はビルド不要の HTML / CSS / JavaScript、ログインの中継だけサーバー側の処理（`functions/api/`）を使う。
置き場所は Cloudflare Workers（2026-11-23 に Netlify の無料枠を使い切ったため。note 版は Netlify のまま）。入口は `worker.js`、設定は `wrangler.jsonc`、公開しないファイルは `.assetsignore`。Cloudflare Pages に置いても動く（`functions/` と `_headers` を使う）。

## できること
- 記事タブ: 「承認待ち」「Qiita に投稿中」「AI が作業中」「公開済み」に分けて一覧。開くと本文のプレビューと品質チェックの結果
- 承認: 「承認して Qiita に投稿」→ `data/approvals/<記事ID>.json` と meta.json（approved）を1回のコミットで書く → GitHub Actions が投稿
- 修正を依頼: `data/requests/fix-<記事ID>-<日時>.txt`
- 依頼タブ: 書いてほしい記事を `data/requests/write-<日時>.txt` に保存
- Qiita のトークンはアプリに入れない（GitHub の Secrets だけ）

## 初期設定（最初に1回・オーナー作業）
### 1. 配信用の公開リポジトリを作る
1. https://github.com/new で `qiita-growth-app` を **Public** で作る（README にチェック）
2. Claude Code に「qiita-growth-app を作った」と伝える（app/ の中身をコピーしてプッシュします）

### 2. Cloudflare にサイトを作る（Workers）
1. https://dash.cloudflare.com でアカウントを作る（無料）
2. 「Workers & Pages」→「Create」→「Import a repository」（Git から作る）→ GitHub につなぐ（許可は `qiita-growth-app` だけ）→ `qiita-growth-app` を選ぶ
3. 「Set up your application」の画面はそのままでよい
   - Project name: `qiita-growth-app`（変えない。`wrangler.jsonc` の name と同じにする）
   - Build command: 空欄、Deploy command: `npx wrangler deploy`（最初から入っている）
4. 「Deploy」→ 1〜2分で完了。表示されたアドレス `https://qiita-growth-app.<あなたの名前>.workers.dev/` を開いて画面が出ればよい（ログインはまだできない）
- 以後、qiita-growth-app の main にプッシュすると自動で公開し直される
- 無料枠の目安（推定。Cloudflare の案内で変わることがある）: ビルドは月3,000分、処理は1日10万回まで。このアプリの使い方なら十分足りる

### 3. GitHub アプリを作る（ログイン用）
1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App
2. 名前: 例 `qiita-growth-<自分の名前>`
3. Homepage URL / Callback URL: さきほどのアドレス `https://qiita-growth-app.<あなたの名前>.workers.dev/`（最後の `/` まで）
4. 「Expire user authorization tokens」に**チェック**、Webhook の「Active」の**チェックを外す**
5. Repository permissions → **Contents: Read and write**（ほかは No access）
6. Where can this GitHub App be installed? → **Only on this account** → Create
7. **Client ID** を控え、「Generate a new client secret」でシークレットを作る（チャットには貼らない）
8. 「Install App」→ **Only select repositories** → `qiita-growth-team` だけ → Install

### 4. Cloudflare に値を入れる
1. Cloudflare の `qiita-growth-app` →「Settings」→「Variables and Secrets」→「Add」
2. `GITHUB_CLIENT_ID` = Client ID、`GITHUB_CLIENT_SECRET` = シークレット。**どちらも Type は Secret** にする（公開し直しても消えない）
3. 「Deploy」を押して保存（保存するとすぐ使われる）

### 5. スマホで開く
`https://qiita-growth-app.<あなたの名前>.workers.dev/` →「設定」→「GitHub でログイン」→ 記事タブに記事が出れば完了。メニューから「ホーム画面に追加」。

## 開発メモ
- 内容ハッシュ（app/domain.js）は src/domain/hash.ts と同じ計算。tests/app-domain.test.ts で一致を確かめている
- 反映するたびに `app/domain.js` の APP_VERSION・APP_CHANGES と `app/sw.js` の CACHE を上げる
