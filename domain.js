// 画面を持たない処理（ブラウザと Node の両方で動く。tests/app-domain.test.ts で確かめる）。
// 内容ハッシュは src/domain/hash.ts と同じ計算にする（違うと承認が一致しない）。

/** app/ を配信用リポジトリに反映するたびに上げる（sw.js の CACHE も） */
export const APP_VERSION = "2026-11-23-1";
export const APP_CHANGES = ["最初の版: 記事の一覧・プレビュー・承認（承認すると Qiita に自動で投稿）・依頼"];

export const DEFAULT_REPO = "gangidenset/qiita-growth-team";

// ---------- 内容ハッシュ ----------

export function normalizeText(text) {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** src/domain/hash.ts の canonicalContent と同じ */
export function canonicalContent({ title, tags, visibility, body }) {
  return JSON.stringify({ v: 1, title: normalizeText(title), tags: [...tags], visibility, body: normalizeText(body) });
}

export async function contentHash(content) {
  const bytes = new TextEncoder().encode(canonicalContent(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 本文のローカル画像（コードブロックの中は除く）。src/domain/hash.ts の localImageRefs と同じ */
export function localImageRefs(markdown) {
  const refs = [];
  let inCode = false;
  for (const line of normalizeText(markdown).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    for (const m of line.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
      if (!/^https:\/\//.test(m[1])) refs.push(m[1]);
    }
  }
  return refs;
}

// ---------- 時刻 ----------

/** 端末のタイムゾーンで、オフセット付きの ISO 8601（例: 2026-11-23T10:15:00+09:00） */
export function toZonedIso(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const pad = (n) => String(n).padStart(2, "0");
  const local = new Date(date.getTime() + offsetMin * 60_000);
  return `${local.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 依頼ファイル名に使う時刻（例: 20261123-101500） */
export function stamp(date) {
  return toZonedIso(date).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

export function formatDate(iso) {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}

// ---------- 状態 ----------

export const STATUS_LABELS = {
  idea: "アイデア",
  researching: "調査中",
  planning: "企画中",
  drafting: "執筆中",
  qa: "品質チェック中",
  needs_revision: "修正中",
  awaiting_approval: "承認待ち",
  approved: "Qiita に投稿中",
  published: "公開済み",
  archived: "中止",
};

/** 一覧の並び（上ほどオーナーの出番） */
export const GROUPS = [
  { key: "awaiting", title: "承認待ち（あなたの出番）", states: ["awaiting_approval"] },
  { key: "posting", title: "Qiita に投稿中", states: ["approved"] },
  { key: "working", title: "AI が作業中", states: ["idea", "researching", "planning", "drafting", "qa", "needs_revision"] },
  { key: "published", title: "公開済み", states: ["published"] },
  { key: "archived", title: "中止", states: ["archived"] },
];

export function groupArticles(articles) {
  return GROUPS.map((g) => ({
    ...g,
    articles: articles
      .filter((a) => g.states.includes(a.meta.status))
      .sort((a, b) => (a.meta.updated_at < b.meta.updated_at ? 1 : -1)),
  })).filter((g) => g.articles.length > 0);
}

/**
 * 承認できるか。できなければ理由（日本語）を返す。
 * src/domain/state-machine.ts の awaiting_approval → approved の条件と、品質チェックの結果を見る
 */
export function approvalBlockers({ meta, body, qa }) {
  const reasons = [];
  if (meta.status !== "awaiting_approval") reasons.push(`いまの状態（${STATUS_LABELS[meta.status] ?? meta.status}）では承認できません`);
  if (body === null || body.trim() === "") reasons.push("本文 article.md がありません");
  if (!Array.isArray(meta.tags) || meta.tags.length < 1 || meta.tags.length > 5) reasons.push("タグは1〜5個必要です");
  if (body) for (const src of localImageRefs(body)) reasons.push(`ローカル画像 ${src} は Qiita に送れません`);
  if (!qa) reasons.push("品質チェックの結果がありません");
  else {
    if (qa.verdict !== "ready_for_approval") reasons.push("品質チェックの判定が「承認待ちに進めてよい」ではありません");
    const critical = qa.results.filter((r) => r.status === "fail" && r.severity === "critical");
    if (critical.length > 0) reasons.push(`重大な指摘が残っています（${critical.map((r) => r.id).join(", ")}）`);
  }
  return reasons;
}

/**
 * 承認の書き込み内容（承認記録と、状態を approved にした meta.json）。1回のコミットで書く
 * @returns {{ path: string, content: string }[]}
 */
export function buildApprovalFiles({ meta, hash, approver, now, previousApproval }) {
  const at = toZonedIso(now);
  const approval = {
    article_id: meta.id,
    content_sha256: hash,
    approved_at: at,
    approved_by: approver || "owner",
    note: previousApproval ? "再承認（アプリ）" : "アプリで承認",
  };
  const nextMeta = {
    ...meta,
    status: "approved",
    updated_at: at,
    history: [...(meta.history ?? []), { from: meta.status, to: "approved", at, actor: "owner", reason: "アプリで承認" }],
  };
  return [
    { path: `data/approvals/${meta.id}.json`, content: `${JSON.stringify(approval, null, 2)}\n` },
    { path: `data/articles/${meta.id}/meta.json`, content: `${JSON.stringify(nextMeta, null, 2)}\n` },
  ];
}

/** Claude Code への依頼（data/requests/）。write = 記事を書いてほしい、fix = 記事を直してほしい */
export function buildRequestFile({ kind, articleId = null, memo, now }) {
  const text = memo.trim();
  if (text === "") throw new Error("依頼の内容を書いてください");
  if (kind === "fix" && !articleId) throw new Error("どの記事を直すかが分かりません");
  const name = kind === "fix" ? `fix-${articleId}-${stamp(now)}.txt` : `write-${stamp(now)}.txt`;
  const lines = [`# kind: ${kind}`, `# requested_at: ${toZonedIso(now)}`];
  if (articleId) lines.push(`article_id: ${articleId}`);
  lines.push("", text, "");
  return { path: `data/requests/${name}`, content: lines.join("\n") };
}

export function parseRepo(value) {
  const m = /^\s*([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\s*$/.exec(value ?? "");
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** 記事フォルダの一覧（data/articles/<ID>/meta.json があるもの。_ で始まるものは除く） */
export function articleIdsFromTree(tree) {
  const ids = [];
  for (const path of tree.keys()) {
    const m = /^data\/articles\/([a-z0-9][a-z0-9-]*)\/meta\.json$/.exec(path);
    if (m) ids.push(m[1]);
  }
  return ids.sort();
}

// ---------- GitHub の失敗 ----------

export const NETWORK_MESSAGE = "GitHub につながりませんでした。電波の状態を確認して、右上の ↻ で読み込み直してください";

export function describeGitHubError({ status, path = "", method = "GET", rateRemaining = null, rateReset = null, now = new Date() }) {
  if (status === 401) return { code: "unauthorized", message: "ログインの期限が切れました。「設定」の「GitHub でログイン」を押してください" };
  if (status === 429 || (status === 403 && rateRemaining === "0")) {
    const resetMs = Number(rateReset) * 1000;
    const minutes = Number.isFinite(resetMs) && resetMs > 0 ? Math.max(1, Math.ceil((resetMs - now.getTime()) / 60_000)) : null;
    return { code: "rate_limited", message: `GitHub の利用回数の上限に達しました。${minutes === null ? "しばらく" : `${minutes}分ほど`}待ってから読み込み直してください` };
  }
  if ((status === 422 || status === 409) && method === "PATCH" && path.startsWith("/git/refs/heads/")) {
    return { code: "conflict", message: "読み込んだ後に GitHub 側が更新されたため、保存できませんでした。↻ で読み込み直してから、もう一度やり直してください" };
  }
  if (status === 403) return { code: "forbidden", message: "この操作の権限がありません。GitHub アプリが qiita-growth-team に入っていて、Contents の読み書きが許可されているか確認してください" };
  if (status === 422) return { code: "rejected", message: "GitHub が内容を受け付けませんでした。Claude Code に「アプリで保存できない」と知らせてください" };
  if (status >= 500) return { code: "server", message: "GitHub 側で一時的な不具合が起きています。少し待ってから読み込み直してください" };
  return { code: "other", message: `GitHub でエラーが起きました（番号 ${status}）` };
}

export function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// ---------- Markdown のプレビュー（Qiita の見た目に近い簡易表示。HTML はすべて文字として扱う） ----------

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(text) {
  // `コード` の中は書式を付けない
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      let s = escapeHtml(part);
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt) => `<span class="img-ph">［画像: ${alt || "説明なし"}］</span>`);
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      return s;
    })
    .join("");
}

function tableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function renderMarkdown(markdown) {
  const lines = normalizeText(markdown).split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length > 0) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const [lang, file] = fence[2].trim().split(":");
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) code.push(lines[i++]);
      i++;
      const label = file || lang;
      out.push(`<div class="code">${label ? `<div class="code-label">${escapeHtml(label)}</div>` : ""}<pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    const note = /^:::note\s*(info|warn|alert)?\s*$/.exec(line.trim());
    if (note) {
      flush();
      const inner = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") inner.push(lines[i++]);
      i++;
      out.push(`<div class="note-box ${note[1] ?? "info"}">${renderMarkdown(inner.join("\n"))}</div>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 1, 6); // 画面の見出しより1段下げる
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(tableRow(lines[i++]));
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const list = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      flush();
      const ordered = /\d/.test(list[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (line.trim() === "") flush();
    else para.push(line);
    i++;
  }
  flush();
  return out.join("\n");
}
