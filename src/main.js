// UI controller for the web build. Drives the same UI-agnostic Game engine the
// TUI uses, rendering its GameEvents into a green-phosphor CRT terminal, and
// adds mobile-friendly affordances (quick-key bar, tap-to-complete).
import "./style.css";
import { Game, EventKind, Phase } from "./engine/game.js";
import { loadLevels, loadEasterEggs, loadCommandGuides } from "./engine/data.js";
import {
  submitRun,
  fetchLeaderboard,
  makeRunRecord,
  leaderboardEnabled,
  subscribeChanges,
  unsubscribe,
  adminDeleteRun,
  adminClearAll,
} from "./leaderboard.js";
import { BANNER, BOOT_LINES, WIN_ART } from "./ui/art.js";

const LEVELS = loadLevels();
const EGGS = loadEasterEggs();
const GUIDES = loadCommandGuides();
const app = document.getElementById("app");

// Per-session state (a fresh Game is built for every player, like the stall).
let game = null;
let playerName = "anonymous";
let resultsChannel = null; // realtime subscription while results screen is shown
let timer = null; // 0.5s HUD/lockdown loop
let blink = true;
let nudges = [];
let history = [];
let histIdx = 0;

const KIND_CLASS = {
  [EventKind.INFO]: "k-info",
  [EventKind.ERROR]: "k-error",
  [EventKind.SUCCESS]: "k-success",
  [EventKind.EASTER]: "k-easter",
  [EventKind.HINT]: "k-hint",
  [EventKind.LEVEL_UP]: "k-level_up",
  [EventKind.WIN]: "k-win",
  [EventKind.LOSE]: "k-lose",
};

function fmtTime(seconds) {
  seconds = Math.trunc(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ============================ START SCREEN ==============================
function renderStart() {
  clearTimer();
  teardownResults();
  app.innerHTML = "";
  const wrap = el("div", "start");
  const banner = el("pre", "banner", BANNER);
  const boot = el("pre", "boot", "");
  const label = el("div", "handle-label", "▶ ENTER YOUR HANDLE (then press Enter):");
  const input = el("input", "text");
  input.placeholder = "your-name";
  input.maxLength = 24;
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.autocorrect = "off";
  input.spellcheck = false;
  const tagline = el("div", "tagline", "curiosity • persistence • problem-solving");

  wrap.append(banner, boot, label, input, tagline);
  app.append(wrap);
  input.focus();

  // Animated boot log (matches the TUI's 0.18s reveal).
  let i = 0;
  const bootTimer = setInterval(() => {
    if (i < BOOT_LINES.length) {
      boot.textContent += (i ? "\n" : "") + BOOT_LINES[i];
      i++;
    } else {
      clearInterval(bootTimer);
    }
  }, 180);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearInterval(bootTimer);
      startGame(input.value);
    }
  });
}

function startGame(name) {
  playerName = ((name || "anonymous").trim().slice(0, 24)) || "anonymous";
  game = new Game(LEVELS, EGGS);
  history = [];
  histIdx = 0;
  nudges = [];
  renderGame();
}

// ============================ GAME SCREEN ==============================
let term, termOut, hudEl, hudInfo, timerEl, timerBar, guideEl, promptLabel, cmdInput;

function renderGame() {
  clearTimer();
  teardownResults();
  app.innerHTML = "";
  const g = el("div", "game");

  hudEl = el("div", "hud");
  hudInfo = el("div", "hud-info");
  const timerBox = el("div", "hud-timer");
  timerEl = el("div", "timer", "00:00");
  timerBar = el("div", "timer-bar", "");
  timerBox.append(timerEl, timerBar);
  hudEl.append(hudInfo, timerBox);

  // The terminal scrolls; output goes in #term-output and the prompt lives as
  // the LAST line inside it, so you type inline at the bottom like a real shell.
  term = el("div", "terminal");
  termOut = el("div", "term-output");
  const prompt = el("form", "prompt-inline");
  promptLabel = el("span", "prompt-label", "");
  cmdInput = el("input");
  cmdInput.placeholder = "type a command — try `help`";
  cmdInput.autocomplete = "off";
  cmdInput.autocapitalize = "off";
  cmdInput.autocorrect = "off";
  cmdInput.spellcheck = false;
  cmdInput.setAttribute("enterkeyhint", "send");
  prompt.append(promptLabel, cmdInput);
  term.append(termOut, prompt);

  guideEl = el("div", "guide");
  guideEl.hidden = true;

  const quick = buildQuickKeys();

  g.append(hudEl, term, guideEl, quick);
  app.append(g);

  prompt.addEventListener("submit", (e) => {
    e.preventDefault();
    submitCommand();
  });
  // Tapping anywhere in the terminal (without selecting text) focuses the input.
  term.addEventListener("click", () => {
    if (!window.getSelection().toString()) cmdInput.focus();
  });
  cmdInput.addEventListener("keydown", onCmdKeydown);
  // When the keyboard opens, keep the latest output in view.
  cmdInput.addEventListener("focus", () => {
    setTimeout(() => {
      term.scrollTop = term.scrollHeight;
    }, 300);
  });

  show(game.start());
  refreshHud();
  refreshPrompt();
  cmdInput.focus();
  timer = setInterval(tick, 500);
}

// Minimal helper keys only — the device's own keyboard does the typing. These
// cover keys that are awkward on a phone keyboard: TAB (completion), the flag
// dash, and an explicit Enter. Each uses pointerdown-preventDefault so tapping
// it does NOT blur the input (which would dismiss the on-screen keyboard).
function buildQuickKeys() {
  const quick = el("div", "quickkeys");

  function key(label, cls, fn) {
    const b = el("button", "qk " + cls, label);
    b.type = "button";
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      fn();
      cmdInput.focus();
    });
    quick.append(b);
  }

  key("⇥ TAB", "accent", () => doComplete());
  key("␣", "", () => insertAtCursor(" "));
  key(".", "", () => insertAtCursor("."));
  key("..", "", () => insertAtCursor(".."));
  key("/", "", () => insertAtCursor("/"));
  key("-", "", () => insertAtCursor("-"));
  key("⏎ ENTER", "accent", () => submitCommand());
  return quick;
}

function insertAtCursor(str) {
  const start = cmdInput.selectionStart ?? cmdInput.value.length;
  const end = cmdInput.selectionEnd ?? cmdInput.value.length;
  cmdInput.value = cmdInput.value.slice(0, start) + str + cmdInput.value.slice(end);
  const pos = start + str.length;
  cmdInput.setSelectionRange(pos, pos);
}

function onCmdKeydown(e) {
  if (e.key === "Tab") {
    e.preventDefault();
    doComplete();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    recallHistory(-1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    recallHistory(1);
  }
}

function recallHistory(dir) {
  if (!history.length) return;
  histIdx = Math.max(0, Math.min(history.length, histIdx + dir));
  cmdInput.value = histIdx < history.length ? history[histIdx] : "";
  const len = cmdInput.value.length;
  requestAnimationFrame(() => cmdInput.setSelectionRange(len, len));
}

function doComplete() {
  const [options, completed] = game.complete(cmdInput.value);
  if (completed && completed !== cmdInput.value) {
    cmdInput.value = completed;
    const len = completed.length;
    cmdInput.setSelectionRange(len, len);
  }
  if (options.length > 1) {
    writeLine(options.join("  "), "k-options");
    term.scrollTop = term.scrollHeight;
  }
}

function submitCommand() {
  const cmd = cmdInput.value;
  cmdInput.value = "";
  if (cmd.trim()) {
    history.push(cmd);
    histIdx = history.length;
  }
  writeLine(`${promptText()} ${cmd}`, "echo");
  const events = game.handle(cmd);
  show(events);
  refreshHud();
  refreshPrompt();
  if ([Phase.WON, Phase.LOCKDOWN, Phase.ABANDONED].includes(game.phase)) {
    showResults();
  }
}

function tick() {
  blink = !blink;
  const ev = game.tick();
  refreshHud();
  if (ev !== null) {
    show([ev]);
    showResults();
  }
}

// --- terminal rendering ---------------------------------------------------
function writeLine(text, cls) {
  const p = el("p", "line" + (cls ? " " + cls : ""), text);
  termOut.append(p);
}

// Strip the ASCII box-drawing so the intro can wrap instead of overflowing.
function stripBox(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("┌") || t.startsWith("╔")) {
      const title = t.replace(/[┌┐╔╗─═]/g, "").trim();
      if (title) out.push(title);
      continue;
    }
    if (t.startsWith("└") || t.startsWith("╚")) continue;
    out.push(line.replace(/^\s*[│┃]\s?/, "").replace(/\s*[│┃]\s*$/, "").replace(/\s+$/, ""));
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Render a level intro as a readable, WRAPPING yellow box (CSS border, not ASCII)
// so the question never overflows sideways — long lines flow to the next line.
function writeIntro(text) {
  const box = el("pre", "line intro-box", stripBox(text));
  termOut.append(box);
  term.scrollTop = term.scrollHeight;
}

function show(events) {
  for (const ev of events) {
    if (ev.kind === EventKind.CLEAR) {
      termOut.innerHTML = "";
      continue;
    }
    if (ev.kind === EventKind.COPY) {
      copyToClipboard(ev.text);
      writeLine(`📋 copied to clipboard: ${ev.text}`, "k-copy");
      continue;
    }
    if (ev.kind === EventKind.HINT) {
      openGuide(ev.text);
      writeLine("→ field guide opened (below)", "k-hint");
      continue;
    }
    if (ev.kind === EventKind.LEVEL_UP) {
      resetGuide();
      if (ev.text) writeIntro(ev.text);
      continue;
    }
    if (!ev.text) continue;
    writeLine(ev.text, KIND_CLASS[ev.kind] || "k-info");
    maybeAutocopyKey(ev);
  }
  term.scrollTop = term.scrollHeight;
}

function maybeAutocopyKey(ev) {
  if (ev.kind !== EventKind.INFO) return;
  const key = game.current_key;
  if (game.phase === Phase.PLAYING && key && ev.text.includes(key)) {
    copyToClipboard(key);
    writeLine("📋 key copied to clipboard — paste it: key <Ctrl+V>", "k-copy");
  }
}

// --- field-guide drawer ---------------------------------------------------
function resetGuide() {
  nudges = [];
  guideEl.hidden = true;
}

function openGuide(nudge) {
  guideEl.hidden = false;
  if (nudge && !nudges.includes(nudge)) nudges.push(nudge);
  buildGuide();
  guideEl.scrollTop = 0;
}

function buildGuide() {
  const lvl = game.current;
  guideEl.innerHTML = "";
  guideEl.append(el("div", "g-title", "FIELD GUIDE"));
  guideEl.append(el("div", "g-sub", `Level ${game.index + 1} · ${lvl.name}`));
  guideEl.append(el("div", "", " "));
  for (const name of lvl.guide || []) {
    const gdef = GUIDES[name];
    if (!gdef) continue;
    const row = el("div", "");
    row.append(el("span", "g-name", gdef.name));
    row.append(el("span", "g-summary", "  " + gdef.summary));
    guideEl.append(row);
    if (gdef.usage) guideEl.append(el("div", "g-usage", "  " + gdef.usage));
    for (const fl of gdef.flags) guideEl.append(el("div", "g-flag", "    " + fl));
    if (gdef.note) guideEl.append(el("div", "g-note", "  " + gdef.note));
    if (gdef.example) guideEl.append(el("div", "g-example", "  e.g. " + gdef.example));
    guideEl.append(el("div", "", " "));
  }
  if (nudges.length) {
    guideEl.append(el("div", "g-nudge-h", "── NUDGES ──"));
    nudges.forEach((n, i) => guideEl.append(el("div", "g-nudge", `${i + 1}. ${n}`)));
  }
  guideEl.append(el("div", "g-note", "tip: `man <cmd>` shows one guide in the terminal"));
}

// --- HUD ------------------------------------------------------------------
function promptText() {
  return `recruit@amfoss:${game.current_path}$`;
}
function refreshPrompt() {
  promptLabel.textContent = promptText();
}

function levelTracker() {
  const cells = [];
  for (let i = 0; i < game.total_keys; i++) {
    if (i < game.index) cells.push(`⟦✔${i + 1}⟧`);
    else if (i === game.index) cells.push(`⟦▶${i + 1}⟧`);
    else cells.push(`⟦·${i + 1}⟧`);
  }
  return cells.join("━");
}

function refreshHud() {
  const g = game;
  const maxScore = g.scoreboard.cfg.max_score;
  const keys = "◈ ".repeat(g.keys_found) + "◇ ".repeat(g.total_keys - g.keys_found);
  const live = blink ? "◉ LIVE" : "○ LIVE";
  hudInfo.textContent =
    `${live}   LEVEL ${g.index + 1}/${g.total_keys} · ${g.current.name}\n` +
    `${levelTracker()}    KEYS ${keys.trim()}    ⬢ SCORE ${g.score}/${maxScore}`;

  const sep = blink ? ":" : " ";
  timerEl.textContent = fmtTime(g.time_left).replace(":", sep);

  const warn = g.time_pressure >= 0.66;
  const danger = g.time_pressure >= 0.85;
  hudEl.classList.toggle("warn", warn && !danger);
  hudEl.classList.toggle("danger", danger);
  timerEl.classList.toggle("warn", warn && !danger);
  timerEl.classList.toggle("danger", danger);

  const left = Math.max(0, Math.min(12, Math.round((1 - g.time_pressure) * 12)));
  timerBar.textContent = "▰".repeat(left) + "▱".repeat(12 - left);
}

// ============================ RESULTS SCREEN ==============================
function bar(pts, mx, width = 14) {
  const fill = mx === 0 ? 0 : Math.round((width * pts) / mx);
  return "▰".repeat(fill) + "▱".repeat(width - fill);
}

function titleArt(outcome, won) {
  if (won) return WIN_ART + `\n  YOU ESCAPED THE TERMINAL  —  ${outcome}\n`;
  return `\n  ${outcome}\n`;
}

function summaryText() {
  const g = game;
  const bd = g.scoreboard.breakdown();
  const lines = [
    "",
    `  ◈ KEYS  ${("▰ ".repeat(g.keys_found).trim()).padEnd(8)}${"▱ ".repeat(g.total_keys - g.keys_found).trim()}   (${g.keys_found}/${g.total_keys})`,
    `  ⏱ TIME  ${fmtTime(g.total_elapsed)}`,
    "",
    "  ┌─ SCORE BREAKDOWN ──────────────────────────────────┐",
  ];
  bd.levels.forEach((lvl, idx) => {
    const status = lvl.solved ? "solved" : "  —   ";
    lines.push(
      `   Level ${idx + 1}  ${bar(lvl.points, lvl.max)}  ${String(lvl.points).padStart(2)}/${String(lvl.max).padEnd(2)}  ${status}`,
    );
  });
  const sign = (n) => (n >= 0 ? "+" : "") + n;
  lines.push(
    `   Finish bonus ........................... ${sign(bd.finish_bonus).padStart(3)}`,
    `   Curiosity (easter eggs) ................ ${sign(bd.easter_egg_bonus).padStart(3)}`,
    `   Bonus puzzles .......................... ${sign(bd.bonus_puzzle_bonus).padStart(3)}`,
    "  └────────────────────────────────────────────────────┘",
    `   ⬢ FINAL SCORE  ${g.score} / ${g.scoreboard.cfg.max_score}   ${bar(g.score, g.scoreboard.cfg.max_score, 24)}`,
    "",
  );
  if (g.phase === Phase.WON) {
    lines.push("  You out-thought the lockdown. Curiosity, persistence, problem-solving");
    lines.push("  — the amFOSS way. This is open source: keep exploring, keep building. 🐧");
  }
  return lines.join("\n");
}

function showResults() {
  clearTimer();
  const g = game;
  const outcome = g.outcome();
  const won = g.phase === Phase.WON;
  app.innerHTML = "";
  const wrap = el("div", "results");
  const card = el("div", "result-card");

  card.append(el("pre", "result-title " + (won ? "win" : "lose"), titleArt(outcome, won)));
  card.append(el("pre", "result-summary", summaryText()));
  card.append(el("div", "field-label", "LEADERBOARD"));

  const table = el("table", "board");
  const thead = el("tr");
  for (const h of ["#", "handle", "score", "outcome", "time"]) thead.append(el("th", "", h));
  table.append(thead);
  const tbody = el("tbody");
  table.append(tbody);
  card.append(table);

  const status = el("div", "sync-status", "syncing scores…");
  card.append(status);

  const buttons = el("div", "buttons");
  const again = el("button", "btn", "Play again");
  const quit = el("button", "btn error", "New player");
  again.addEventListener("click", renderStart);
  quit.addEventListener("click", renderStart);
  buttons.append(again, quit);
  card.append(buttons);

  wrap.append(card);
  app.append(wrap);
  again.focus();

  submitAndLoad(g, tbody, status);
}

function populateBoard(tbody, rows, myId) {
  tbody.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = el("tr", r.id === myId ? "me" : "");
    const marker = r.id === myId ? "➤ " : "";
    [
      String(i + 1),
      marker + r.name,
      String(r.score),
      r.outcome,
      fmtTime(r.total_seconds),
    ].forEach((c) => tr.append(el("td", "", c)));
    tbody.append(tr);
  });
}

async function submitAndLoad(g, tbody, status) {
  const record = makeRunRecord({
    name: playerName,
    score: g.score,
    outcome: g.outcome(),
    levels_completed: g.keys_found,
    total_seconds: g.total_elapsed,
    details: g.details(),
  });
  const reached = await submitRun(record);
  populateBoard(tbody, await fetchLeaderboard(10), record.id);

  status.textContent = !leaderboardEnabled
    ? "ℹ local leaderboard (set VITE_SUPABASE_* to sync to the cloud)"
    : reached
      ? "✔ score synced — board updates live"
      : "⚠ offline — score saved locally on this device";

  // Live: re-pull the board whenever anyone finishes while this screen is up.
  teardownResults();
  resultsChannel = subscribeChanges(async () => {
    populateBoard(tbody, await fetchLeaderboard(10), record.id);
  });
}

function teardownResults() {
  if (resultsChannel) {
    unsubscribe(resultsChannel);
    resultsChannel = null;
  }
}

// Keep the app sized to the *visual* viewport so the prompt + quick-keys stay
// visible above the on-screen keyboard on phones (the layout viewport doesn't
// shrink when the keyboard opens, which otherwise hides the input).
function syncViewportHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-h", `${h}px`);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportHeight);
  window.visualViewport.addEventListener("scroll", syncViewportHeight);
}
window.addEventListener("resize", syncViewportHeight);
syncViewportHeight();

// ============================ ADMIN (hidden) ============================
// Access: press F2, OR tap the top-left corner 5× quickly. Password is verified
// server-side via RPC (a wrong password just errors) — no service key here.
const ADMIN_DUMMY_ID = "00000000-0000-0000-0000-000000000000";

function openAdminLogin() {
  if (document.getElementById("admin-modal")) return;
  const ov = el("div", "modal");
  ov.id = "admin-modal";
  const box = el("div", "modal-box");
  box.append(el("div", "modal-title", "🔒  ADMIN"));
  const inp = el("input", "text");
  inp.type = "password";
  inp.placeholder = "password";
  inp.autocomplete = "off";
  const msg = el("div", "modal-msg");
  const row = el("div", "buttons");
  const ok = el("button", "btn", "Enter");
  const cancel = el("button", "btn error", "Cancel");
  row.append(ok, cancel);
  box.append(inp, msg, row);
  ov.append(box);
  document.body.append(ov);
  inp.focus();

  const submit = async () => {
    const pw = inp.value;
    msg.textContent = "checking…";
    // Verify by attempting to delete a non-existent id (0 rows, no side effect).
    const res = await adminDeleteRun(pw, ADMIN_DUMMY_ID);
    if (res.ok) {
      ov.remove();
      openAdminPanel(pw);
    } else {
      msg.textContent = res.error === "offline" ? "Supabase not configured" : "✖ access denied";
      inp.value = "";
    }
  };
  ok.addEventListener("click", submit);
  cancel.addEventListener("click", () => ov.remove());
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") ov.remove();
  });
}

// Persist admin deadline edits so a kiosk keeps them across reloads.
const DEADLINE_KEY = "escape_terminal_deadlines";
function saveDeadlines() {
  try {
    localStorage.setItem(
      DEADLINE_KEY,
      JSON.stringify(Object.fromEntries(LEVELS.map((l) => [l.id, l.target_seconds]))),
    );
  } catch {
    /* storage unavailable — ignore */
  }
}
function applyDeadlineOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(DEADLINE_KEY) || "{}");
    LEVELS.forEach((l) => {
      if (o[l.id] > 0) l.target_seconds = o[l.id];
    });
  } catch {
    /* ignore */
  }
}

function openAdminPanel(pw) {
  const ov = el("div", "modal");
  ov.id = "admin-modal";
  const box = el("div", "modal-box wide admin-panel");
  box.append(el("div", "modal-title", "⚙  ADMIN CONSOLE"));
  const status = el("div", "modal-msg");

  let selectedId = null;
  let selectedRow = null;

  // --- level deadlines (edit the in-memory levels; affects the next game) ----
  box.append(el("div", "field-label", "Level deadlines (seconds) — each is a HARD limit:"));
  const dl = el("div", "admin-deadlines");
  const inputs = [];
  LEVELS.forEach((lvl, i) => {
    dl.append(el("span", "admin-plabel", `L${i + 1}`));
    const inp = el("input", "admin-param");
    inp.type = "number";
    inp.min = "5";
    inp.value = String(lvl.target_seconds);
    inputs.push(inp);
    dl.append(inp);
  });
  const apply = el("button", "btn small", "Apply");
  dl.append(apply);
  box.append(dl);
  const dlInfo = el("div", "admin-sub");
  box.append(dlInfo);
  const refreshDl = () => {
    dlInfo.textContent =
      "Hard deadlines: " +
      LEVELS.map((l, i) => `L${i + 1} ${fmtTime(l.target_seconds)}`).join("  ·  ");
  };
  refreshDl();
  apply.addEventListener("click", () => {
    let ok = true;
    LEVELS.forEach((l, i) => {
      const v = parseInt(inputs[i].value, 10);
      if (Number.isFinite(v) && v > 0) l.target_seconds = v;
      else ok = false;
    });
    saveDeadlines();
    refreshDl();
    status.textContent = ok
      ? "✔ deadlines applied — affect the next game on this device."
      : "⚠ some values were invalid and skipped.";
  });

  // --- leaderboard table (tap a row, then act) ------------------------------
  box.append(el("div", "field-label", "Leaderboard — tap a row, then act:"));
  let adminRows = [];
  const adminSearch = el("input", "text search");
  adminSearch.placeholder = "filter by handle…";
  adminSearch.autocomplete = "off";
  adminSearch.autocapitalize = "off";
  adminSearch.spellcheck = false;
  adminSearch.addEventListener("input", () => renderTable());
  box.append(adminSearch);
  const wrap = el("div", "admin-table-wrap");
  const table = el("table", "board");
  const thead = el("tr");
  ["#", "handle", "score", "outcome", "time"].forEach((h) => thead.append(el("th", "", h)));
  table.append(thead);
  const tbody = el("tbody");
  table.append(tbody);
  wrap.append(table);
  box.append(wrap);

  const row = el("div", "buttons");
  const refresh = el("button", "btn small", "Refresh");
  const copyBtn = el("button", "btn small", "Copy row");
  const remove = el("button", "btn small error", "Remove selected");
  const clear = el("button", "btn small error", "Clear ALL");
  const close = el("button", "btn small", "Close");
  row.append(refresh, copyBtn, remove, clear, close);
  box.append(status, row);
  ov.append(box);
  document.body.append(ov);
  close.addEventListener("click", () => ov.remove());

  function renderTable() {
    const t = adminSearch.value.trim().toLowerCase();
    tbody.innerHTML = "";
    adminRows.forEach((r, i) => {
      if (t && !r.name.toLowerCase().includes(t)) return; // keep global rank (i+1)
      const tr = el("tr");
      tr.dataset.id = r.id;
      [String(i + 1), r.name, String(r.score), r.outcome, fmtTime(r.total_seconds)].forEach(
        (c) => tr.append(el("td", "", c)),
      );
      tr.addEventListener("click", () => {
        tbody.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel"));
        tr.classList.add("sel");
        selectedId = r.id;
        selectedRow = r;
      });
      tbody.append(tr);
    });
  }

  async function load() {
    status.textContent = "loading…";
    selectedId = null;
    selectedRow = null;
    adminRows = await fetchLeaderboard(200);
    renderTable();
    status.textContent = `${adminRows.length} run(s)`;
  }

  refresh.addEventListener("click", load);
  copyBtn.addEventListener("click", async () => {
    if (!selectedRow) return void (status.textContent = "Select a row first.");
    const r = selectedRow;
    await copyToClipboard(`${r.name}  ${r.score}  ${r.outcome}  ${fmtTime(r.total_seconds)}`);
    status.textContent = "📋 row copied to clipboard";
  });
  remove.addEventListener("click", async () => {
    if (!selectedId) return void (status.textContent = "Select a row first.");
    const res = await adminDeleteRun(pw, selectedId);
    status.textContent = res.ok ? "✔ removed" : "✖ " + (res.error || "failed");
    load();
  });
  clear.addEventListener("click", async () => {
    if (!confirm("Delete ALL scores? This cannot be undone.")) return;
    const res = await adminClearAll(pw);
    status.textContent = res.ok ? `cleared ${res.count} run(s)` : "✖ " + (res.error || "failed");
    load();
  });
  load();
}

function wireAdminAccess() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      openAdminLogin();
    }
  });
  const hot = el("div", "admin-hotspot");
  document.body.append(hot);
  let taps = 0;
  let last = 0;
  hot.addEventListener("click", () => {
    const now = performance.now();
    if (now - last > 1500) taps = 0;
    last = now;
    if (++taps >= 5) {
      taps = 0;
      openAdminLogin();
    }
  });
}

// Global shortcuts (desktop): Ctrl+R restart.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    renderStart();
  }
});

applyDeadlineOverrides();
wireAdminAccess();
renderStart();
