// Game content + tunables — ported 1:1 from the Python package.
//
// The puzzle content (levels, easter eggs, command guides) is the SAME data the
// TUI uses: content.json is produced from escape_terminal/content/*.yaml by the
// project's own loader, so the web game behaves identically. Edit puzzles in the
// YAML, regenerate content.json (see webapp/README.md), and both apps update.
import CONTENT from "./content.json";

// --- Scoring / difficulty (mirror of escape_terminal/config.py:ScoringConfig) -
export const SCORING = {
  max_score: 100,
  solve_base: 20, // banked for solving a level at all
  speed_bonus_max: 10, // extra, scaled by how much target time remained
  finish_bonus: 10, // solving all three levels
  invalid_command_grace: 3,
  invalid_command_penalty: 2,
  failed_unlock_penalty: 5,
  easter_egg_bonus: 1, // per unique easter egg discovered
  bonus_puzzle_bonus: 5, // per hidden bonus puzzle solved
};

// --- Levels ----------------------------------------------------------------
export function loadLevels() {
  return CONTENT.levels.levels.map((item) => {
    let bonus = null;
    if (item.bonus) {
      bonus = {
        id: item.bonus.id,
        answer: item.bonus.answer,
        reveal: item.bonus.reveal ?? "",
      };
    }
    return {
      id: item.id,
      name: item.name,
      objective: item.objective ?? "",
      target_seconds: parseInt(item.target_seconds, 10),
      intro: item.intro ?? "",
      files: item.files ?? {},
      start_dir: item.start_dir ?? "/",
      key: item.key ?? "",
      key_prefix: item.key_prefix ?? "ESCAPE",
      randomize_key: item.randomize_key ?? true,
      key_aliases: item.key_aliases ?? [],
      hints: item.hints ?? [],
      guide: item.guide ?? [],
      success: item.success ?? "Key accepted.",
      bonus,
    };
  });
}

// --- Easter eggs (triggers lowercased, as in load_easter_eggs) -------------
export function loadEasterEggs() {
  return (CONTENT.easter_eggs.easter_eggs ?? []).map((e) => ({
    id: e.id,
    triggers: e.triggers.map((t) => t.toLowerCase()),
    response: e.response,
  }));
}

// --- Command guides (for `man` + the field-guide panel) --------------------
export function loadCommandGuides() {
  const guides = {};
  for (const c of CONTENT.commands.commands ?? []) {
    guides[c.name] = {
      name: c.name,
      summary: c.summary ?? "",
      usage: c.usage ?? "",
      note: c.note ?? "",
      example: c.example ?? "",
      flags: c.flags ?? [],
    };
  }
  return guides;
}

export function manText(name, guides) {
  const g = guides[name];
  if (!g) {
    return `man: no manual entry for '${name}'. Type \`help\` for the command list.`;
  }
  const lines = [`${g.name} — ${g.summary}`];
  if (g.usage) lines.push(`  usage:   ${g.usage}`);
  for (const fl of g.flags) lines.push(`    ${fl}`);
  if (g.note) lines.push(`  note:    ${g.note}`);
  if (g.example) lines.push(`  example: ${g.example}`);
  return lines.join("\n");
}
