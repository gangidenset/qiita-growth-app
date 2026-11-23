// Cloudflare Workers の入口。/api/ はログインの中継（functions/api/ と同じ処理）、それ以外は画面のファイル（静的アセット）を返す。
// 設定は wrangler.jsonc。Cloudflare Pages に置く場合はこのファイルは使われない（functions/ が使われる）
import { onRequestGet as config } from "./functions/api/config.js";
import { exchangeToken } from "./functions/api/github-token.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action https://github.com",
};

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    let response;
    if (pathname === "/api/config") {
      response = request.method === "GET" ? config({ env }) : new Response("method not allowed", { status: 405 });
    } else if (pathname === "/api/github-token") {
      response = await exchangeToken(request, env);
    } else if (pathname.startsWith("/api/")) {
      response = new Response("not found", { status: 404 });
    } else {
      response = await env.ASSETS.fetch(request);
    }
    return withSecurityHeaders(response);
  },
};
