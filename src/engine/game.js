// The game state machine — UI-agnostic brain (port of engine/game.py).
import { SCORING } from "./data.js";
import { COMPLETABLE, Interpreter } from "./interpreter.js";
import { generateKey, keyTokens, render } from "./keys.js";
import { Scoreboard } from "./scoring.js";
import { FSError, VirtualFS } from "./vfs.js";

export const Phase = {
  READY: "ready",
  PLAYING: "playing",
  WON: "won",
  LOCKDOWN: "lockdown",
  ABANDONED: "abandoned",
};

export const EventKind = {
  INFO: "info",
  ERROR: "error",
  SUCCESS: "success",
  EASTER: "easter",
  HINT: "hint",
  LEVEL_UP: "level_up",
  WIN: "win",
  LOSE: "lose",
  CLEAR: "clear",
  COPY: "copy",
};

export function gameEvent(kind, text = "") {
  return { kind, text };
}

function commonPrefix(names) {
  if (!names.length) return "";
  let shortest = names[0];
  for (const n of names) if (n.length < shortest.length) shortest = n;
  for (let i = 0; i < shortest.length; i++) {
    const ch = shortest[i];
    if (names.some((n) => n[i] !== ch)) return shortest.slice(0, i);
  }
  return shortest;
}

const monotonic = () => performance.now() / 1000;

export class Game {
  constructor(levels, easterEggs = [], cfg = SCORING, now = monotonic) {
    this.levels = levels;
    this.easter_eggs = easterEggs;
    this.cfg = cfg;
    this.now = now;

    this.phase = Phase.READY;
    this.index = 0;
    this.scoreboard = new Scoreboard(cfg);

    this._fs = null;
    this._interp = null;
    this._level_started_at = 0.0;
    this._game_started_at = -1.0;
    this._hint_idx = 0;
    this._keys = {};
    this._active_key = "";
    this._last_output = "";
  }

  // --- lifecycle -----------------------------------------------------------
  get current() {
    return this.levels[this.index];
  }

  start() {
    this.phase = Phase.PLAYING;
    this.index = 0;
    this._generateKeys();
    this._game_started_at = this.now();
    return this._enterLevel();
  }

  _generateKeys() {
    this._keys = {};
    const used = new Set();
    for (const lvl of this.levels) {
      let key;
      if (lvl.key && !lvl.randomize_key) {
        key = lvl.key;
      } else {
        key = generateKey(lvl.key_prefix);
        while (used.has(key)) key = generateKey(lvl.key_prefix);
      }
      used.add(key);
      this._keys[lvl.id] = key;
    }
  }

  _enterLevel() {
    const lvl = this.current;
    this._active_key = this._keys[lvl.id];
    const rendered = render(lvl.files, keyTokens(this._active_key));
    this._fs = VirtualFS.fromDict(rendered, lvl.start_dir);
    this._interp = new Interpreter(this._fs);
    this._level_started_at = this.now();
    this._hint_idx = 0;
    this.scoreboard.level(lvl.id, lvl.target_seconds);
    return [gameEvent(EventKind.LEVEL_UP, lvl.intro)];
  }

  get level_elapsed() {
    if (this.phase !== Phase.PLAYING) return 0.0;
    return this.now() - this._level_started_at;
  }

  get total_elapsed() {
    if (this._game_started_at < 0) return 0.0;
    return this.now() - this._game_started_at;
  }

  get score() {
    return this.scoreboard.total();
  }

  get current_key() {
    return this._active_key;
  }

  get keys_found() {
    return this.scoreboard.levels_completed;
  }

  get total_keys() {
    return this.levels.length;
  }

  get time_left() {
    return Math.max(0.0, this.current.target_seconds - this.level_elapsed);
  }

  get current_path() {
    if (this._fs === null) return "~";
    const path = this._fs.pwd();
    return path.replace("/home/recruit", "~") || "/";
  }

  get time_pressure() {
    const target = this.current.target_seconds || 1;
    return this.level_elapsed / target;
  }

  // --- per-second tick: each level's target is a HARD DEADLINE -------------
  tick() {
    if (this.phase !== Phase.PLAYING) return null;
    if (this.level_elapsed >= this.current.target_seconds) {
      this._recordLevelTime();
      this.scoreboard.level(this.current.id, this.current.target_seconds).timed_out = true;
      this.phase = Phase.LOCKDOWN;
      return gameEvent(
        EventKind.LOSE,
        `TIME UP on Level ${this.index + 1} — the deadline passed. SYSTEM LOCKDOWN.`,
      );
    }
    return null;
  }

  // --- main input handler --------------------------------------------------
  handle(raw) {
    if (this.phase !== Phase.PLAYING) return [];
    raw = raw.replace(/\n+$/, "");
    const stripped = raw.trim();
    if (!stripped) return [];

    if (stripped.toLowerCase() === "copy") return [this._copyEvent()];

    // A correct bonus-puzzle answer wins over easter eggs and the interpreter
    // (e.g. "git init" would otherwise fire the `git` egg).
    const earlyBonus = this._maybeBonus(stripped);
    if (earlyBonus !== null) return [earlyBonus];

    const egg = this._matchEgg(stripped);
    if (egg !== null) {
      const firstTime = !this.scoreboard.easter_eggs.has(egg.id);
      this.scoreboard.easter_eggs.add(egg.id);
      const suffix = firstTime ? "  (+1 curiosity)" : "";
      return [gameEvent(EventKind.EASTER, egg.response + suffix)];
    }

    const result = this._interp.run(raw);
    const stats = this.scoreboard.level(this.current.id, this.current.target_seconds);

    if (result.cleared) return [gameEvent(EventKind.CLEAR)];
    if (result.quit) return this._abandon();
    if (result.hint) return [this._nextHint()];
    if (result.submit_key !== null) return this._submitKey(result.submit_key);

    if (!result.valid) {
      stats.invalid_commands += 1;
      return [gameEvent(EventKind.ERROR, result.output)];
    }
    if (result.output) this._last_output = result.output;
    return [gameEvent(EventKind.INFO, result.output)];
  }

  _copyEvent() {
    if (this._active_key && (this._last_output || "").includes(this._active_key)) {
      return gameEvent(EventKind.COPY, this._active_key);
    }
    if (this._last_output) {
      return gameEvent(EventKind.COPY, this._last_output.trim());
    }
    return gameEvent(EventKind.INFO, "Nothing to copy yet — reveal something first.");
  }

  // --- tab completion ------------------------------------------------------
  complete(text) {
    if (this._fs === null) return [[], text];
    const endsSpace = text.endsWith(" ");
    const parts = text.split(/\s+/).filter(Boolean);
    if (!parts.length) return [[], text];
    if (parts.length === 1 && !endsSpace) {
      const token = parts[0];
      const matches = COMPLETABLE.filter((c) => c.startsWith(token)).map((c) => [c, false]);
      return this._finishCompletion(text, token, matches, " ");
    }
    const token = endsSpace ? "" : parts[parts.length - 1];
    const base = token.includes("/") ? token.slice(0, token.lastIndexOf("/") + 1) : "";
    const prefix = token.slice(base.length);
    let entries;
    try {
      entries = this._fs.entries(base, prefix.startsWith("."));
    } catch (e) {
      if (e instanceof FSError) return [[], text];
      throw e;
    }
    const matches = entries.filter(([n]) => n.startsWith(prefix));
    return this._finishCompletion(text, token, matches, " ");
  }

  _finishCompletion(text, token, matches, trailing = "") {
    if (!matches.length) return [[], text];
    const names = matches.map(([n]) => n);
    const base = token.includes("/") ? token.slice(0, token.lastIndexOf("/") + 1) : "";
    let completedToken;
    if (matches.length === 1) {
      const [name, isDir] = matches[0];
      completedToken = base + name + (isDir ? "/" : trailing);
    } else {
      completedToken = base + commonPrefix(names);
    }
    const completed = text.slice(0, text.length - token.length) + completedToken;
    const options = matches.map(([n, d]) => n + (d ? "/" : ""));
    return [options.length > 1 ? options : [], completed];
  }

  // --- helpers -------------------------------------------------------------
  _matchEgg(text) {
    const low = text.toLowerCase();
    const words = low.split(/\s+/).filter(Boolean);
    const first = words.length ? words[0] : "";
    for (const egg of this.easter_eggs) {
      for (const trig of egg.triggers) {
        if (low === trig || first === trig) return egg;
      }
    }
    return null;
  }

  _maybeBonus(text) {
    const lvl = this.current;
    if (!lvl.bonus) return null;
    if (this.scoreboard.bonus_puzzles.has(lvl.bonus.id)) return null;
    if (text.trim().toUpperCase() === lvl.bonus.answer.trim().toUpperCase()) {
      this.scoreboard.bonus_puzzles.add(lvl.bonus.id);
      return gameEvent(EventKind.SUCCESS, lvl.bonus.reveal || "Bonus puzzle solved!  (+5)");
    }
    return null;
  }

  _nextHint() {
    const hints = this.current.hints;
    if (!hints.length) {
      return gameEvent(EventKind.HINT, "No hints for this level — trust your instincts.");
    }
    const hint = hints[Math.min(this._hint_idx, hints.length - 1)];
    this._hint_idx += 1;
    return gameEvent(EventKind.HINT, hint);
  }

  _recordLevelTime() {
    const stats = this.scoreboard.level(this.current.id, this.current.target_seconds);
    stats.elapsed_seconds = this.now() - this._level_started_at;
  }

  _keyMatches(submitted) {
    const clean = submitted.trim().replace(/^['"]+|['"]+$/g, "").toUpperCase();
    return clean === this._active_key.trim().toUpperCase();
  }

  _submitKey(submitted) {
    const lvl = this.current;
    const stats = this.scoreboard.level(lvl.id, lvl.target_seconds);
    if (!this._keyMatches(submitted)) {
      stats.failed_unlocks += 1;
      return [gameEvent(EventKind.ERROR, "Access denied. That key is incorrect. Keep looking.")];
    }
    this._recordLevelTime();
    stats.completed = true;
    const events = [gameEvent(EventKind.SUCCESS, lvl.success)];
    if (this.index + 1 < this.levels.length) {
      this.index += 1;
      events.push(...this._enterLevel());
    } else {
      this.phase = Phase.WON;
      this.scoreboard.finished = true;
      events.push(gameEvent(EventKind.WIN, "The last door opens. You step out. FREEDOM."));
    }
    return events;
  }

  _abandon() {
    this._recordLevelTime();
    this.phase = Phase.ABANDONED;
    return [gameEvent(EventKind.LOSE, "You walked away from the terminal.")];
  }

  // Full per-player breakdown for storage: per-level time + split points, etc.
  details() {
    const bd = this.scoreboard.breakdown();
    const byId = {};
    for (const l of this.levels) byId[l.id] = l;
    const bdById = {};
    for (const l of bd.levels) bdById[l.id] = l;
    const levels = this.scoreboard.levels.map((s, i) => {
      const b = bdById[s.level_id] || {};
      return {
        index: i + 1,
        id: s.level_id,
        name: byId[s.level_id] ? byId[s.level_id].name : s.level_id,
        target_seconds: s.target_seconds,
        elapsed_seconds: Math.round(s.elapsed_seconds * 100) / 100,
        points: b.points ?? 0,
        max: b.max ?? 0,
        solved: s.completed,
        invalid_commands: s.invalid_commands,
        failed_unlocks: s.failed_unlocks,
        timed_out: s.timed_out,
      };
    });
    return {
      levels,
      finish_bonus: bd.finish_bonus,
      easter_egg_bonus: bd.easter_egg_bonus,
      bonus_puzzle_bonus: bd.bonus_puzzle_bonus,
      easter_eggs_found: [...this.scoreboard.easter_eggs].sort(),
      bonus_puzzles_solved: [...this.scoreboard.bonus_puzzles].sort(),
    };
  }

  // --- results -------------------------------------------------------------
  outcome() {
    const completed = this.scoreboard.levels_completed;
    if (this.phase === Phase.WON) return this.score >= 90 ? "CLEAN ESCAPE" : "ESCAPED";
    if (this.phase === Phase.LOCKDOWN) return "SYSTEM LOCKDOWN";
    if (completed > 0) return "PARTIAL ESCAPE";
    return "STILL TRAPPED";
  }
}
