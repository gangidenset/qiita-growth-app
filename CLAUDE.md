# CLAUDE.md — qiita-growth-app（アプリの配信用）

- **オーナーへの返答・報告は、必ず日本語で書く**。コマンド・ファイル名・コードはそのままでよい。
- このリポジトリは配信用のコピー（Cloudflare Workers が main を公開する）。アプリの正本は非公開リポジトリ qiita-growth-team の `app/`。ここを直接直さず、正本を直してから中身を丸ごとコピーする。
- 運用ルール（記事・承認・自動投稿など）は qiita-growth-team の CLAUDE.md に従う。
- main へのプッシュのたびに Cloudflare の公開（ビルド）の枠を使う。反映はオーナーの了承のあと、まとめて1回。
