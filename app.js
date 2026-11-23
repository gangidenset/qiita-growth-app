// 画面の動き。データの読み書きは GitHub（qiita-growth-team）だけ。Qiita への投稿は承認のあと GitHub Actions が行う。
import { completeLogin, getAccessToken, isLoggedIn, logout, startLogin } from "./auth.js";
import {
  APP_CHANGES,
  APP_VERSION,
  DEFAULT_REPO,
  STATUS_LABELS,
  approvalBlockers,
  articleIdsFromTree,
  buildApprovalFiles,
  buildRequestFile,
  contentHash,
  formatDate,
  groupArticles,
  parseRepo,
  renderMarkdown,
} from "./domain.js";
import { GitHubRepo } from "./github.js";

const SETTINGS_KEY = "qgt-settings";
const $ = (id) => document.getElementById(id);

const state = {
  repo: null,
  head: null,
  articles: [],
  /** 開いている記事の ID（なければ一覧） */
  openId: null,
  busy: false,
};

// ---------- 設定 ----------

function loadSettings() {
  try {
    return { repo: DEFAULT_REPO, branch: "", approver: "", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { repo: DEFAULT_REPO, branch: "", approver: "" };
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境では、その場限りの設定になる
  }
}

// ---------- 表示の小物 ----------

function notice(message, ok = false) {
  const el = $("notice");
  el.textContent = message;
  el.className = ok ? "notice ok" : "notice";
  el.hidden = !message;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v; // renderMarkdown など、文字を逃がした HTML だけに使う
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function badge(status) {
  return el("span", { class: `badge ${status}` }, STATUS_LABELS[status] ?? status);
}

function showTab(name) {
  for (const btn of document.querySelectorAll(".tabs button")) {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
    $(`tab-${btn.dataset.tab}`).hidden = !active;
  }
}

// ---------- 読み込み ----------

function makeRepo() {
  const s = loadSettings();
  const parsed = parseRepo(s.repo);
  if (!parsed) throw new Error("「設定」のリポジトリを「持ち主/名前」の形で入れてください");
  return new GitHubRepo({ getToken: getAccessToken, ...parsed, branch: s.branch, onUnauthorized: () => renderSettings() });
}

async function load() {
  if (!isLoggedIn()) {
    renderArticles();
    notice("「設定」で「GitHub でログイン」を押してください");
    return;
  }
  notice("読み込み中…", true);
  const repo = makeRepo();
  if (!repo.branch) repo.branch = (await repo.info()).default_branch;
  const head = await repo.headSha();
  const tree = await repo.readTree(head);
  if (!tree) throw new Error("ファイルが多すぎて一覧を読めませんでした。Claude Code に知らせてください");
  const ids = articleIdsFromTree(tree);
  const articles = await Promise.all(
    ids.map(async (id) => {
      const base = `data/articles/${id}`;
      const [meta, body, qa, approval] = await Promise.all([
        repo.treeJson(tree, `${base}/meta.json`),
        repo.treeText(tree, `${base}/article.md`),
        repo.treeJson(tree, `${base}/qa.json`).catch(() => null),
        repo.treeJson(tree, `data/approvals/${id}.json`).catch(() => null),
      ]);
      const hash = body === null ? null : await contentHash({ title: meta.title, tags: meta.tags ?? [], visibility: meta.visibility ?? "public", body });
      return { meta, body, qa, approval, hash };
    }),
  );
  Object.assign(state, { repo, head, articles });
  notice("");
  render();
}

async function safely(task) {
  if (state.busy) return;
  state.busy = true;
  try {
    await task();
  } catch (e) {
    notice(e instanceof Error ? e.message : String(e));
  } finally {
    state.busy = false;
  }
}

// ---------- 記事の一覧と詳細 ----------

function render() {
  renderArticles();
  renderSettings();
}

function renderArticles() {
  const root = $("tab-articles");
  root.replaceChildren();
  if (!isLoggedIn()) {
    root.append(el("p", { class: "muted" }, "ログインすると、記事の一覧が出ます。"));
    return;
  }
  const open = state.articles.find((a) => a.meta.id === state.openId);
  if (open) return root.append(...articleDetail(open));
  if (state.articles.length === 0) {
    root.append(el("p", { class: "muted" }, "記事はまだありません。「依頼」タブから書いてほしい記事を頼めます。"));
    return;
  }
  for (const group of groupArticles(state.articles)) {
    root.append(el("h2", {}, `${group.title}（${group.articles.length}）`));
    for (const a of group.articles) {
      root.append(
        el(
          "button",
          { class: `card${group.key === "awaiting" ? " awaiting" : ""}`, onclick: () => openArticle(a.meta.id) },
          el("div", { class: "title" }, a.meta.title),
          el("div", {}, badge(a.meta.status), ...(a.meta.tags ?? []).map((t) => el("span", { class: "badge tag" }, t))),
          el("div", { class: "meta" }, `更新 ${formatDate(a.meta.updated_at)}${a.meta.visibility === "limited" ? " ・限定共有" : ""}`),
        ),
      );
    }
  }
}

function openArticle(id) {
  state.openId = id;
  renderArticles();
  window.scrollTo(0, 0);
}

function qaSection(qa) {
  if (!qa) return el("p", { class: "muted" }, "品質チェックはまだです。");
  const fails = qa.results.filter((r) => r.status !== "pass");
  return el(
    "details",
    {},
    el("summary", {}, `品質チェック: ${qa.verdict === "ready_for_approval" ? "承認に進めてよい" : "修正が必要"}（${formatDate(qa.checked_at)}）`),
    el(
      "ul",
      { class: "plain" },
      qa.results.map((r) =>
        el("li", { class: r.status === "fail" ? "qa-fail" : "" }, `${r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "－"} ${r.id}${r.severity ? `（${r.severity}）` : ""}${r.note ? `: ${r.note}` : ""}`),
      ),
    ),
    fails.length === 0 ? null : el("p", { class: "muted" }, `合格でない項目: ${fails.length} 件`),
  );
}

function articleDetail(a) {
  const { meta } = a;
  const parts = [
    el("button", { class: "secondary back", onclick: () => openArticle(null) }, "← 一覧へ"),
    el("h2", {}, meta.title),
    el("div", {}, badge(meta.status), ...(meta.tags ?? []).map((t) => el("span", { class: "badge tag" }, t))),
    el("p", { class: "meta" }, `公開範囲: ${meta.visibility === "limited" ? "限定共有（URL を知っている人だけ）" : "公開"} ／ 更新 ${formatDate(meta.updated_at)}`),
  ];
  if (meta.qiita) {
    parts.push(el("p", {}, el("a", { class: "button secondary", href: meta.qiita.url, target: "_blank", rel: "noopener noreferrer" }, "Qiita で開く")));
  }
  parts.push(...actions(a));
  parts.push(qaSection(a.qa));
  parts.push(el("h3", {}, "本文のプレビュー"));
  parts.push(
    a.body === null
      ? el("p", { class: "muted" }, "本文はまだありません。")
      : el("div", { class: "card md", html: renderMarkdown(a.body) }),
  );
  parts.push(el("p", { class: "muted" }, "プレビューは簡易表示です。Qiita での見た目とは少し違うことがあります（画像・Mermaid の図は文字のまま表示）。"));
  return parts;
}

function actions(a) {
  const out = [];
  const { meta } = a;
  if (meta.status === "awaiting_approval") {
    const blockers = approvalBlockers(a);
    if (blockers.length > 0) out.push(el("div", { class: "warn" }, `承認できません:\n${blockers.map((b) => `・${b}`).join("\n")}`));
    out.push(
      el(
        "div",
        { class: "row" },
        el("button", { disabled: blockers.length > 0, onclick: () => safely(() => approve(a)) }, meta.qiita ? "承認して Qiita の記事を更新" : "承認して Qiita に投稿"),
        el("button", { class: "secondary", onclick: () => askFix(a) }, "修正を依頼する"),
      ),
    );
    out.push(el("p", { class: "muted" }, "承認すると、数分で GitHub Actions が Qiita に投稿します。承認したあとに本文が変わると、投稿は止まります。"));
  } else if (meta.status === "approved") {
    out.push(el("div", { class: "warn" }, "承認済みです。GitHub Actions が Qiita に投稿しています（数分）。↻ で読み込み直すと結果が出ます。10分たっても変わらないときは、GitHub の Actions タブで qiita-publish の結果を見てください。"));
  } else if (meta.status === "published") {
    out.push(el("div", { class: "row" }, el("button", { class: "secondary", onclick: () => askFix(a) }, "修正を依頼する")));
    out.push(el("p", { class: "muted" }, "直した記事を承認し直すと、同じ Qiita の記事が更新されます。"));
  }
  return out;
}

async function approve(a) {
  const blockers = approvalBlockers(a);
  if (blockers.length > 0 || a.hash === null) return;
  const where = a.meta.visibility === "limited" ? "限定共有" : "公開";
  if (!confirm(`「${a.meta.title}」を承認します。\n承認すると、数分で Qiita に${where}で${a.meta.qiita ? "更新" : "投稿"}されます。よいですか？`)) return;
  const files = buildApprovalFiles({
    meta: a.meta,
    hash: a.hash,
    approver: loadSettings().approver,
    now: new Date(),
    previousApproval: a.approval,
  });
  // 読み込んだ時点（state.head）から変わっていたら失敗する＝見た本文と承認する本文が同じになる
  await state.repo.commitFiles(files, `承認: ${a.meta.id}（アプリ）`, state.head);
  await load();
  notice("承認しました。数分で Qiita に投稿されます。", true);
}

function askFix(a) {
  const dialog = $("dialog");
  const memo = el("textarea", { rows: 6, placeholder: "例: 2つ目の手順のコマンドを Windows でも動く形にしてほしい" });
  dialog.replaceChildren(
    el("h2", { id: "dialog-title" }, "修正を依頼する"),
    el("p", { class: "muted" }, `「${a.meta.title}」をどう直してほしいかを書いてください。保存すると data/requests/ に残ります。Claude Code に「修正依頼を反映して」と頼んでください。`),
    el("label", {}, "直してほしいこと", memo),
    el(
      "div",
      { class: "row" },
      el("button", { onclick: () => safely(async () => { await saveRequest({ kind: "fix", articleId: a.meta.id, memo: memo.value }); dialog.close(); }) }, "依頼を保存"),
      el("button", { class: "secondary", onclick: () => dialog.close() }, "やめる"),
    ),
  );
  dialog.showModal();
}

async function saveRequest({ kind, articleId = null, memo }) {
  if (!state.repo) throw new Error("先に「設定」でログインしてください");
  const file = buildRequestFile({ kind, articleId, memo, now: new Date() });
  await state.repo.commitFiles([file], `依頼: ${file.path.split("/").pop()}（アプリ）`, state.head);
  await load();
  notice(`依頼を保存しました（${file.path}）。Claude Code に「${file.path} の依頼を実行して」と頼んでください。`, true);
}

// ---------- 設定 ----------

function renderSettings() {
  const s = loadSettings();
  const logged = isLoggedIn();
  $("s-login-status").textContent = logged ? "ログインしています" : "ログインしていません";
  $("s-login").hidden = logged;
  $("s-logout").hidden = !logged;
  $("s-repo").value = s.repo;
  $("s-branch").value = s.branch;
  $("s-approver").value = s.approver;
  $("s-version").textContent = `版 ${APP_VERSION}: ${APP_CHANGES.join(" / ")}`;
}

function bind() {
  for (const btn of document.querySelectorAll(".tabs button")) btn.addEventListener("click", () => showTab(btn.dataset.tab));
  $("reload").addEventListener("click", () => safely(load));
  $("s-login").addEventListener("click", () => safely(startLogin));
  $("s-logout").addEventListener("click", () => {
    logout();
    Object.assign(state, { repo: null, head: null, articles: [], openId: null });
    render();
    notice("ログアウトしました", true);
  });
  $("s-save").addEventListener("click", () => {
    saveSettings({ repo: $("s-repo").value.trim() || DEFAULT_REPO, branch: $("s-branch").value.trim(), approver: $("s-approver").value.trim() });
    safely(load);
  });
  $("r-save").addEventListener("click", () =>
    safely(async () => {
      await saveRequest({ kind: "write", memo: $("r-memo").value });
      $("r-memo").value = "";
    }),
  );
}

async function main() {
  bind();
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await safely(async () => {
    if (await completeLogin()) notice("ログインしました", true);
    await load();
  });
}

main();
