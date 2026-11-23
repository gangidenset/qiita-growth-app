# Qiita Growth アプリ（スマホ用 PWA）

スマホ・PC から、記事の確認（プレビュー・品質チェック）・承認・依頼ができるアプリ。承認すると GitHub Actions が Qiita に自動で投稿する。
画面はビルド不要の HTML / CSS / JavaScript、ログインの中継だけ Cloudflare Pages Functions（`functions/api/`）を使う。
置き場所は Cloudflare Pages（2026-11-23 に Netlify の無料枠を使い切ったため。note 版は Netlify のまま）。

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

### 2. Cloudflare Pages にサイトを作る
1. https://dash.cloudflare.com でアカウントを作る（無料。メールアドレスの確認がある）
2. 左メニュー「Workers & Pages」（「Compute」の中にあることもある）→「Create」→「**Pages**」のタブ →「Import an existing Git repository」
   - Workers の画面が出たら、下の方の「Pages」へのリンク（Looking to deploy Pages? など）を押す
3. 「Connect GitHub」→ GitHub の画面で **Only select repositories** → `qiita-growth-app` だけ → Install & Authorize
4. `qiita-growth-app` を選んで「Begin setup」
   - Project name: 例 `qiita-growth-xxxx`（URL は `https://<名前>.pages.dev/` になる）
   - Production branch: `main`
   - Framework preset: **None**、Build command: **空欄**、Build output directory: 空欄（入力を求められたら `/`）
5. 「Save and Deploy」→ 1分ほどで完了。`https://<名前>.pages.dev/` を開いて画面が出ればよい（ログインはまだできない）
- 無料枠の目安（推定。Cloudflare の案内で変わることがある）: 公開は月500回、ログインの中継は1日10万回まで。このアプリの使い方なら十分足りる

### 3. GitHub アプリを作る（ログイン用）
1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App
2. 名前: 例 `qiita-growth-<自分の名前>`
3. Homepage URL / Callback URL: `https://<名前>.pages.dev/`（最後の `/` まで）
4. 「Expire user authorization tokens」に**チェック**、Webhook の「Active」の**チェックを外す**
5. Repository permissions → **Contents: Read and write**（ほかは No access）
6. Where can this GitHub App be installed? → **Only on this account** → Create
7. **Client ID** を控え、「Generate a new client secret」でシークレットを作る（チャットには貼らない）
8. 「Install App」→ **Only select repositories** → `qiita-growth-team` だけ → Install

### 4. Cloudflare に値を入れる
1. Cloudflare のプロジェクト →「Settings」→「Variables and Secrets」→「Add」
2. `GITHUB_CLIENT_ID` = Client ID（Type: Text）
3. `GITHUB_CLIENT_SECRET` = シークレット（Type: **Secret**）。どちらも Production に入れる
4. 「Deployments」→ いちばん上の公開の「…」→「Retry deployment」で反映（値は公開し直したときに使われる）

### 5. スマホで開く
`https://<名前>.pages.dev/` →「設定」→「GitHub でログイン」→ 記事タブに記事が出れば完了。メニューから「ホーム画面に追加」。

## 開発メモ
- 内容ハッシュ（app/domain.js）は src/domain/hash.ts と同じ計算。tests/app-domain.test.ts で一致を確かめている
- 反映するたびに `app/domain.js` の APP_VERSION・APP_CHANGES と `app/sw.js` の CACHE を上げる
