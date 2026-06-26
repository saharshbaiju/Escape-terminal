// Parity harness: run fixed command sequences through the JS engine with a
// PINNED key and dump results as JSON, to diff against the Python engine.
import { loadLevels } from "../src/engine/data.js";
import { keyTokens, render } from "../src/engine/keys.js";
import { VirtualFS } from "../src/engine/vfs.js";
import { Interpreter } from "../src/engine/interpreter.js";
import { Scoreboard } from "../src/engine/scoring.js";
import { levelPoints } from "../src/engine/scoring.js";

const KEY = "ESCAPE-ABCDE";
const PHRASE_B64 = keyTokens(KEY).KEY_PHRASE_B64;

const SEQS = {
  "level-1": ["ls", "ls -a", "ls -al", "pwd", "cat README.txt", "cat .bashrc",
    "cd .escape", "ls", "cat key.txt", "cd ..", "tree", "find key",
    "grep -i escape", "grep -in door", "base64 -d aGVsbG8=", "rot13 uryyb",
    "file mission.txt", "man grep", "cat nope.txt", "frobnicate"],
  "level-2": ["ls", "pwd", "grep -in DOORKEY", "grep -i escape archive",
    "find log", "tree", "cat archive/exit.log", "cat CHANGELOG.md"],
  "level-3": ["ls -a", "pwd", "cat README.txt", "cat fragment.b64",
    `base64 -d ${PHRASE_B64}`, "tree", "cat .trash/old_fragment.b64"],
};

const out = {};
for (const lvl of loadLevels()) {
  const rendered = render(lvl.files, keyTokens(KEY));
  const fs = VirtualFS.fromDict(rendered, lvl.start_dir);
  const interp = new Interpreter(fs);
  out[lvl.id] = (SEQS[lvl.id] || []).map((cmd) => {
    const r = interp.run(cmd);
    return { cmd, output: r.output, valid: r.valid, submit_key: r.submit_key };
  });
}

// scoring parity: a representative solved level
const sb = new Scoreboard();
const s = sb.level("level-1", 60);
s.completed = true;
s.elapsed_seconds = 18;
s.invalid_commands = 5;
s.failed_unlocks = 1;
out._scoring = {
  points: levelPoints(s, sb.cfg),
  total_with_eggs: (sb.easter_eggs.add("a"), sb.easter_eggs.add("b"), sb.total()),
};

console.log(JSON.stringify(out, null, 2));
