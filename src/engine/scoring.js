// Pure scoring logic — earn-up model (port of engine/scoring.py).
import { SCORING } from "./data.js";

export function makeLevelStats(levelId, targetSeconds) {
  return {
    level_id: levelId,
    target_seconds: targetSeconds,
    elapsed_seconds: 0.0,
    invalid_commands: 0,
    failed_unlocks: 0,
    completed: false,
    timed_out: false,
  };
}

export function levelPoints(stats, cfg) {
  if (!stats.completed) return 0;
  let frac = 0.0;
  if (stats.target_seconds > 0) {
    frac = Math.max(0.0, 1.0 - stats.elapsed_seconds / stats.target_seconds);
  }
  const speed = Math.round(cfg.speed_bonus_max * frac);
  const invalidPen =
    Math.max(0, stats.invalid_commands - cfg.invalid_command_grace) *
    cfg.invalid_command_penalty;
  const unlockPen = stats.failed_unlocks * cfg.failed_unlock_penalty;
  return Math.max(0, cfg.solve_base + speed - invalidPen - unlockPen);
}

export function levelMax(cfg) {
  return cfg.solve_base + cfg.speed_bonus_max;
}

export class Scoreboard {
  constructor(cfg = SCORING) {
    this.cfg = cfg;
    this.levels = [];
    this.easter_eggs = new Set();
    this.bonus_puzzles = new Set();
    this.finished = false;
  }

  level(levelId, targetSeconds) {
    for (const s of this.levels) if (s.level_id === levelId) return s;
    const s = makeLevelStats(levelId, targetSeconds);
    this.levels.push(s);
    return s;
  }

  breakdown() {
    const cfg = this.cfg;
    const perLevel = this.levels.map((s) => ({
      id: s.level_id,
      points: levelPoints(s, cfg),
      max: levelMax(cfg),
      solved: s.completed,
    }));
    return {
      levels: perLevel,
      finish_bonus: this.finished ? cfg.finish_bonus : 0,
      easter_egg_bonus: this.easter_eggs.size * cfg.easter_egg_bonus,
      bonus_puzzle_bonus: this.bonus_puzzles.size * cfg.bonus_puzzle_bonus,
    };
  }

  total() {
    const bd = this.breakdown();
    const raw =
      bd.levels.reduce((a, l) => a + l.points, 0) +
      bd.finish_bonus +
      bd.easter_egg_bonus +
      bd.bonus_puzzle_bonus;
    return Math.max(0, Math.min(raw, this.cfg.max_score));
  }

  get total_elapsed() {
    return this.levels.reduce((a, s) => a + s.elapsed_seconds, 0);
  }

  get levels_completed() {
    return this.levels.filter((s) => s.completed).length;
  }
}
