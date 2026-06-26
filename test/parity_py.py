"""Python-side parity reference: same fixed scenario as test/parity.js."""
import json
import sys
sys.path.insert(0, "../..")  # repo root, to import escape_terminal

from escape_terminal.engine.levels import load_levels
from escape_terminal.engine.keys import key_tokens, render
from escape_terminal.engine.vfs import VirtualFS
from escape_terminal.engine.interpreter import Interpreter
from escape_terminal.engine.scoring import Scoreboard, level_points

KEY = "ESCAPE-ABCDE"
PHRASE_B64 = key_tokens(KEY)["KEY_PHRASE_B64"]

SEQS = {
    "level-1": ["ls", "ls -a", "ls -al", "pwd", "cat README.txt", "cat .bashrc",
        "cd .escape", "ls", "cat key.txt", "cd ..", "tree", "find key",
        "grep -i escape", "grep -in door", "base64 -d aGVsbG8=", "rot13 uryyb",
        "file mission.txt", "man grep", "cat nope.txt", "frobnicate"],
    "level-2": ["ls", "pwd", "grep -in DOORKEY", "grep -i escape archive",
        "find log", "tree", "cat archive/exit.log", "cat CHANGELOG.md"],
    "level-3": ["ls -a", "pwd", "cat README.txt", "cat fragment.b64",
        f"base64 -d {PHRASE_B64}", "tree", "cat .trash/old_fragment.b64"],
}

out = {}
for lvl in load_levels():
    rendered = render(lvl.files, key_tokens(KEY))
    fs = VirtualFS.from_dict(rendered, lvl.start_dir)
    interp = Interpreter(fs)
    out[lvl.id] = []
    for cmd in SEQS.get(lvl.id, []):
        r = interp.run(cmd)
        out[lvl.id].append({"cmd": cmd, "output": r.output, "valid": r.valid,
                            "submit_key": r.submit_key})

sb = Scoreboard()
s = sb.level("level-1", 60)
s.completed = True
s.elapsed_seconds = 18
s.invalid_commands = 5
s.failed_unlocks = 1
sb.easter_eggs.add("a")
sb.easter_eggs.add("b")
out["_scoring"] = {"points": level_points(s, sb.cfg), "total_with_eggs": sb.total()}

print(json.dumps(out, indent=2, ensure_ascii=False))
