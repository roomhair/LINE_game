import { CATEGORIES, NAME_POOL, AVATAR_POOL, AVATAR_COLORS, GEN_TOPICS, GEN_OPENERS, RANKS } from "./data.js";
import { localScore, localReactions } from "./scorer.js";

const TOTAL_ROUNDS = 5;
const MIX = { id: "mix", name: "ごちゃまぜ", emoji: "🎲" };
const RANDOM = { id: "random", name: "おまかせ", emoji: "✨" };

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても遊べる */ } },
};

let aiAvailable = false;
let state = null;
let selectedTheme = RANDOM.id;
let clock = null;

// ===== 初期化 =====
init();

function init() {
  const chips = $("theme-chips");
  for (const t of [RANDOM, ...CATEGORIES, MIX]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(t.id === selectedTheme));
    b.dataset.id = t.id;
    b.textContent = `${t.emoji} ${t.name}`;
    b.onclick = () => {
      selectedTheme = t.id;
      chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-checked", String(c.dataset.id === t.id)));
    };
    chips.appendChild(b);
  }

  $("player-name").value = store.get("lg_name") || "";
  renderBest();

  $("start-btn").onclick = startGame;
  $("again-btn").onclick = startGame;
  $("home-btn").onclick = () => showScreen("title");
  $("share-btn").onclick = shareResult;
  // ダイアログが使えない環境もあるので、2回押しで戻る
  let quitArmed = 0;
  $("quit-btn").onclick = () => {
    if (Date.now() - quitArmed < 2500) { state = null; showScreen("title"); return; }
    quitArmed = Date.now();
    toast("もう一度押すとタイトルに戻ります");
  };

  const input = $("msg-input");
  input.addEventListener("input", () => {
    $("send-btn").disabled = input.disabled || input.value.trim() === "";
    autoGrow(input);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); sendReply(); });

  checkAI();
}

async function checkAI() {
  const badge = $("mode-badge");
  try {
    const r = await fetchWithTimeout("/api/status", {}, 4000);
    aiAvailable = r.ok && (await r.json()).ai === true;
  } catch { aiAvailable = false; }
  badge.textContent = aiAvailable ? "🤖 AI審査モード" : "📋 かんたん審査モード";
  badge.classList.toggle("ai", aiAvailable);
}

function renderBest() {
  const best = Number(store.get("lg_best") || 0);
  $("best-score").textContent = best ? `自己ベスト ${best}pt` : "";
}

function showScreen(name) {
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === `screen-${name}`);
  if (name === "title") renderBest();
}

// ===== ゲーム開始 =====
function startGame() {
  const name = $("player-name").value.trim().slice(0, 12) || "あなた";
  store.set("lg_name", name === "あなた" ? "" : name);

  const category = chooseCategory();
  const usedNames = new Set([name]);
  const groups = buildGroups(category).map((g) => ({ ...g, members: makeMembers(usedNames) }));

  state = {
    me: name,
    category,
    groups,
    rounds: [],
    idx: 0,
    total: 0,
    nextOpener: null,
  };
  clock = new Date();
  clock.setHours(7 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));

  updateHud();
  showScreen("chat");
  $("log").innerHTML = "";
  playRound();
}

function chooseCategory() {
  if (selectedTheme === MIX.id) return MIX;
  if (selectedTheme !== RANDOM.id) return CATEGORIES.find((c) => c.id === selectedTheme);
  // おまかせ：前回と同じテーマにならないように
  const last = store.get("lg_last_cat");
  const options = [...CATEGORIES, MIX].filter((c) => c.id !== last);
  const c = pick(options);
  store.set("lg_last_cat", c.id);
  return c;
}

function buildGroups(category) {
  let list;
  if (category.id === MIX.id) {
    list = shuffle(CATEGORIES.map((c) => pick(c.groups))).slice(0, TOTAL_ROUNDS - 1);
    list.splice(Math.floor(Math.random() * TOTAL_ROUNDS), 0, generateGroup());
  } else {
    list = shuffle(category.groups).slice(0, TOTAL_ROUNDS);
    while (list.length < TOTAL_ROUNDS) list.push(generateGroup());
  }
  return list.map((g) => ({ name: g.name, icon: g.icon, scenario: pick(g.s), lurkers: Math.floor(Math.random() * 7) }));
}

// 「今日の〇〇」グループをその場で作る
function generateGroup() {
  const [topic, icon] = pick(GEN_TOPICS);
  const tpl = pick(GEN_OPENERS);
  const sub = (s) => s.replaceAll("{t}", topic);
  return {
    name: `今日の${topic}`,
    icon,
    s: [{ m: tpl.m.map(([who, text]) => [who, sub(text)]), k: tpl.k.map(sub) }],
  };
}

function makeMembers(used) {
  const names = shuffle(NAME_POOL.filter((n) => !used.has(n))).slice(0, 3);
  names.forEach((n) => used.add(n));
  const avatars = shuffle(AVATAR_POOL);
  return names.map((n, i) => ({ name: n, avatar: avatars[i], color: pick(AVATAR_COLORS) }));
}

// ===== ラウンド進行 =====
async function playRound() {
  const game = state;
  const alive = () => state === game;
  const g = state.groups[state.idx];
  const members = g.members;

  // AIが書いた新しい書き出しが届いていればそちらを使う（毎回ちがう展開に）
  let opener = null;
  if (state.nextOpener) {
    opener = await Promise.race([state.nextOpener, sleep(2500).then(() => null)]);
    state.nextOpener = null;
    if (!alive()) return;
  }
  const byKey = { A: members[0], B: members[1], C: members[2] };
  const messages = opener
    ? opener.messages.map((m) => ({ member: members.find((x) => x.name === m.name) || members[0], text: fill(m.text, members) }))
    : g.scenario.m.map(([who, text]) => ({ member: byKey[who], text: fill(text, members) }));
  const keywords = opener ? opener.keywords : g.scenario.k;

  const round = { group: g, messages, keywords, reply: "", result: null };
  state.rounds.push(round);
  updateHud();

  // 次のグループの書き出しをAIに先読みしてもらう
  if (aiAvailable && state.idx + 1 < TOTAL_ROUNDS) prefetchOpener(state.groups[state.idx + 1]);

  await showNotification(g, messages[0]);
  if (!alive()) return;

  // ヘッダー切り替え＆トーク履歴
  $("group-icon").textContent = g.icon;
  $("group-name").textContent = `${g.name} (${members.length + 1 + g.lurkers})`;
  $("group-count").textContent = `${members.map((m) => m.name).join("、")}、${state.me}${g.lurkers ? ` ほか${g.lurkers}人` : ""}`;
  const log = $("log");
  log.innerHTML = "";
  addDateSep(`今日 ・ ${state.idx + 1}件目のトーク`);

  for (const m of messages) {
    await typing(m.member, 450 + Math.min(900, m.text.length * 25));
    if (!alive()) return;
    addMessage(m.member, m.text);
    await sleep(180);
  }
  if (!alive()) return;
  addSys("あなたの返信を待っています…");
  enableInput(true);
}

function prefetchOpener(group) {
  state.nextOpener = fetchWithTimeout("/api/opener", jsonPost({
    group: group.name,
    members: group.members.map((m) => m.name),
    avoid: state.rounds.map((r) => r.messages.map((m) => m.text).join(" ").slice(0, 60)),
  }), 15000)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.messages) && d.messages.length >= 2 ? d : null))
    .catch(() => null);
}

async function sendReply() {
  const input = $("msg-input");
  const text = input.value.trim();
  if (!text || !state) return;
  const game = state;
  const alive = () => state === game;
  const round = state.rounds[state.idx];
  if (round.reply) return;
  round.reply = text;

  input.value = "";
  autoGrow(input);
  enableInput(false);
  removeSys();
  const myMsg = addMessage(null, text);

  const g = round.group;
  const judging = judge(round);

  await sleep(600);
  if (!alive()) return;
  setRead(myMsg, g.members.length);

  // 返事を考え中…
  const thinker = pick(g.members);
  const typingEl = showTyping(thinker);
  const result = await judging;
  typingEl.remove();
  if (!alive()) return;

  round.result = result;
  for (const [i, r] of result.reactions.entries()) {
    const member = g.members.find((m) => m.name === r.name) || g.members[0];
    if (i > 0) await typing(member, 400 + Math.min(800, r.text.length * 25));
    if (!alive()) return;
    addMessage(member, fill(r.text, g.members));
    await sleep(250);
  }

  state.total += result.score;
  await sleep(300);
  if (!alive()) return;
  addScoreCard(result);
  updateHud(true);
}

async function judge(round) {
  const g = round.group;
  const previousReplies = state.rounds.slice(0, state.idx).map((r) => r.reply);
  if (aiAvailable) {
    try {
      const r = await fetchWithTimeout("/api/judge", jsonPost({
        group: g.name,
        me: state.me,
        members: g.members.map((m) => m.name),
        messages: round.messages.map((m) => ({ name: m.member.name, text: m.text })),
        reply: round.reply,
        previous: previousReplies,
      }), 25000);
      if (r.ok) {
        const d = await r.json();
        if (typeof d.score === "number" && Array.isArray(d.reactions) && d.reactions.length) return { ...d, by: "ai" };
      }
    } catch { /* ローカル採点にフォールバック */ }
  }
  await sleep(700 + Math.random() * 600);
  const s = localScore({
    reply: round.reply,
    scenarioText: round.messages.map((m) => m.text).join(" "),
    keywords: round.keywords || [],
    previousReplies,
  });
  return { ...s, reactions: localReactions(s.score, g.members), by: "local" };
}

function next() {
  state.idx += 1;
  if (state.idx >= TOTAL_ROUNDS) return showResult();
  playRound();
}

// ===== 描画 =====
function fill(text, members) {
  return String(text)
    .replaceAll("{me}", state.me)
    .replaceAll("{A}", members[0]?.name ?? "")
    .replaceAll("{B}", members[1]?.name ?? "")
    .replaceAll("{C}", members[2]?.name ?? "");
}

function tick() {
  clock = new Date(clock.getTime() + (1 + Math.floor(Math.random() * 3)) * 60000);
  const h = clock.getHours();
  return `${h < 12 ? "午前" : "午後"}${((h + 11) % 12) + 1}:${String(clock.getMinutes()).padStart(2, "0")}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function scrollDown() {
  const log = $("log");
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function addDateSep(text) { $("log").appendChild(el("div", "date-sep", text)); }
function addSys(text) { const s = el("div", "sys-msg", text); s.dataset.wait = "1"; $("log").appendChild(s); scrollDown(); }
function removeSys() { $("log").querySelectorAll('[data-wait="1"]').forEach((e) => e.remove()); }

function avatarEl(member) {
  const a = el("div", "avatar", member.avatar);
  a.style.background = member.color;
  return a;
}

// member が null なら自分の発言
function addMessage(member, text) {
  const mine = !member;
  const wrap = el("div", `msg ${mine ? "me" : "other"}`);
  if (!mine) wrap.appendChild(avatarEl(member));
  const body = el("div", "body");
  if (!mine) body.appendChild(el("div", "name", member.name));
  const row = el("div", "row");
  row.appendChild(el("div", "bubble", text));
  const meta = el("div", "meta");
  meta.innerHTML = `<div class="read"></div><div>${tick()}</div>`;
  row.appendChild(meta);
  body.appendChild(row);
  wrap.appendChild(body);
  $("log").appendChild(wrap);
  scrollDown();
  return wrap;
}

function setRead(msgEl, n) {
  const r = msgEl.querySelector(".read");
  if (r) r.textContent = `既読 ${n}`;
}

function showTyping(member) {
  const wrap = el("div", "msg other typing");
  wrap.appendChild(avatarEl(member));
  const body = el("div", "body");
  body.appendChild(el("div", "name", member.name));
  const b = el("div", "bubble");
  b.innerHTML = "<i></i><i></i><i></i>";
  body.appendChild(b);
  wrap.appendChild(body);
  $("log").appendChild(wrap);
  scrollDown();
  return wrap;
}

async function typing(member, ms) {
  const t = showTyping(member);
  await sleep(ms);
  t.remove();
}

function grade(score) {
  if (score >= 90) return ["神", "g-s"];
  if (score >= 75) return ["最高", "g-s"];
  if (score >= 60) return ["ナイス", ""];
  if (score >= 40) return ["まずまず", ""];
  return ["がんばろう", "g-c"];
}

function addScoreCard(result) {
  const [label, cls] = grade(result.score);
  const card = el("div", "score-card");
  card.innerHTML = `
    <div class="sc-top">
      <div><div class="sc-label">${state.idx + 1}回目の返信</div><div class="sc-points">+${result.score}<small>pt</small></div></div>
      <div class="sc-grade ${cls}">${label}</div>
    </div>
    <div class="sc-comment"></div>
    <div class="bars">
      ${[["humor", "面白さ"], ["wit", "気の利き"], ["surprise", "意外性"], ["fit", "空気読み"]].map(([k, n]) =>
        `<span class="bl">${n}</span><span class="bt"><span class="bf" data-v="${result[k]}"></span></span><span class="bv">${result[k]}/25</span>`).join("")}
    </div>
    <div class="sc-by">${result.by === "ai" ? "🤖 AI審査" : "📋 かんたん審査"}</div>`;
  card.querySelector(".sc-comment").textContent = result.comment;
  const btn = el("button", "btn-primary", state.idx + 1 >= TOTAL_ROUNDS ? "結果を見る 🏁" : "次のLINEへ →");
  btn.onclick = () => { btn.disabled = true; next(); };
  card.appendChild(btn);
  $("log").appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.querySelectorAll(".bf").forEach((b) => { b.style.width = `${(Number(b.dataset.v) / 25) * 100}%`; });
  }));
  scrollDown();
  setTimeout(() => btn.focus({ preventScroll: true }), 400);
}

function updateHud(bump = false) {
  const done = state.rounds.filter((r) => r.result).length;
  $("hud-round").textContent = `${Math.min(state.idx + 1, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}`;
  $("hud-score").textContent = state.total;
  $("hud-left").textContent = TOTAL_ROUNDS - done;
  const dots = $("hud-dots");
  dots.innerHTML = "";
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const d = el("i", i < done ? "done" : i === state.idx ? "now" : "");
    dots.appendChild(d);
  }
  if (bump) {
    const s = $("hud-score");
    s.classList.remove("bump");
    void s.offsetWidth;
    s.classList.add("bump");
  }
}

function enableInput(on) {
  const input = $("msg-input");
  input.disabled = !on;
  $("send-btn").disabled = !on || input.value.trim() === "";
  input.placeholder = on ? "メッセージを入力" : "…";
  if (on && matchMedia("(pointer: fine)").matches) input.focus();
}

function autoGrow(t) {
  t.style.height = "auto";
  t.style.height = `${Math.min(110, t.scrollHeight)}px`;
}

function showNotification(group, first) {
  return new Promise((resolve) => {
    const n = $("notif");
    $("notif-icon").textContent = group.icon;
    $("notif-title").textContent = group.name;
    $("notif-text").textContent = `${first.member.name}: ${first.text}`;
    n.classList.remove("out");
    n.hidden = false;
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      n.classList.add("out");
      setTimeout(() => { n.hidden = true; resolve(); }, 280);
    };
    n.onclick = close;
    setTimeout(close, 1500);
  });
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

// ===== 結果 =====
function showResult() {
  const total = state.total;
  const rank = RANKS.find((r) => total >= r.min);
  $("rank-emoji").textContent = rank.emoji;
  $("rank-title").textContent = rank.title;
  $("result-total").textContent = total;
  $("rank-text").textContent = rank.text;

  const prev = Number(store.get("lg_best") || 0);
  $("result-new").hidden = total <= prev;
  if (total > prev) store.set("lg_best", String(total));

  const best = [...state.rounds].sort((a, b) => b.result.score - a.result.score)[0];
  const br = $("best-reply");
  br.innerHTML = '<div class="br-label">🏅 今日のベスト返信</div><div class="br-text"></div><div class="br-group"></div>';
  br.querySelector(".br-text").textContent = `「${best.reply}」`;
  br.querySelector(".br-group").textContent = `${best.group.name} ・ ${best.result.score}pt ・ ${best.result.comment}`;

  const list = $("result-list");
  list.innerHTML = "";
  for (const r of state.rounds) {
    const li = el("li");
    li.appendChild(el("div", "ri", r.group.icon));
    const mid = el("div");
    mid.appendChild(el("div", "rg", r.group.name));
    mid.appendChild(el("div", "rr", r.reply));
    li.appendChild(mid);
    const s = el("div", "rs");
    s.innerHTML = `${r.result.score}<small>pt</small>`;
    li.appendChild(s);
    list.appendChild(li);
  }
  showScreen("result");
  $("screen-result").scrollTop = 0;
}

async function shareResult() {
  if (!state) return;
  const rank = RANKS.find((r) => state.total >= r.min);
  const best = [...state.rounds].sort((a, b) => b.result.score - a.result.score)[0];
  const text = `今日のLINEゲーム【${state.category.emoji}${state.category.name}】\n${state.total}/500pt「${rank.title}${rank.emoji}」\nベスト返信：「${best.reply}」(${best.result.score}pt)\n${location.origin}\n#今日のLINEゲーム`;
  try {
    await navigator.clipboard.writeText(text);
    toast("結果をコピーしました");
  } catch {
    toast("コピーできませんでした");
  }
}

// ===== 通信 =====
function jsonPost(body) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}
