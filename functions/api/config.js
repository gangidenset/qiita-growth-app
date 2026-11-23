// Cloudflare Pages Functions: 画面がログインを始めるのに必要な公開情報（クライアントID）だけを返す。シークレットは返さない。
// /api/config に対応する（functions/ の中の場所がそのまま URL になる）

export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ client_id: env.GITHUB_CLIENT_ID ?? "" }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
