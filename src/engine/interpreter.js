// Simulated command interpreter (port of engine/interpreter.py).
import { b64encode, b64decode, rot13, shlexSplit } from "./codecs.js";
import { loadCommandGuides, manText } from "./data.js";
import { FSError } from "./vfs.js";

const GUIDES = loadCommandGuides();

export function makeResult(over = {}) {
  return {
    output: "",
    valid: true,
    cleared: false,
    quit: false,
    submit_key: null,
    easter_egg: null,
    hint: false,
    ...over,
  };
}

export const HELP_TEXT = `Available commands:
  ls [-a] [-l] [path]   list directory contents  (-a shows hidden files!)
  cd <path>             change directory          (cd .. goes up)
  pwd                   print working directory
  cat <file>            show a file's contents
  find [name]           list files in the tree, optionally matching a name
  grep [-i] <text>      search inside files for text
  file <path>           describe what a path is
  base64 -d <text>      decode a base64 string
  rot13 <text>          decode a ROT13 string
  tree                  show the directory tree
  man <command>         show a brief guide for a command (e.g. \`man grep\`)
  hint                  open the FIELD GUIDE side panel + a nudge (costs nothing)
  copy                  copy the most recently revealed key to your clipboard
  key <VALUE>           submit an access key to open the next door
  clear                 clear the screen
  help                  show this help
  exit                  give up and see your results

Tip: press TAB to auto-complete commands and file names.
`;

// Commands offered by TAB completion (primary names, no aliases).
export const COMPLETABLE = [
  "ls", "cd", "pwd", "cat", "find", "grep", "file", "tree", "man",
  "base64", "rot13", "hint", "copy", "key", "clear", "help", "exit",
];

export class Interpreter {
  constructor(fs) {
    this.fs = fs;
  }

  run(raw) {
    raw = raw.trim();
    if (!raw) return makeResult({ valid: true });
    let argv;
    try {
      argv = shlexSplit(raw);
    } catch {
      argv = raw.split(/\s+/);
    }
    if (argv.length === 0) return makeResult({ valid: true });
    const cmd = argv[0];
    const args = argv.slice(1);
    const handler = this._dispatch[cmd];
    if (!handler) return this._unknown(cmd);
    try {
      return handler.call(this, args);
    } catch (exc) {
      if (exc instanceof FSError) {
        return makeResult({ output: `${cmd}: ${exc.message}`, valid: false });
      }
      throw exc;
    }
  }

  get _dispatch() {
    return {
      ls: this._cmd_ls,
      la: this._cmd_la,
      cd: this._cmd_cd,
      pwd: this._cmd_pwd,
      cat: this._cmd_cat,
      file: this._cmd_file,
      find: this._cmd_find,
      grep: this._cmd_grep,
      tree: this._cmd_tree,
      base64: this._cmd_base64,
      rot13: this._cmd_rot13,
      man: this._cmd_man,
      key: this._cmd_key,
      unlock: this._cmd_unlock,
      hint: this._cmd_hint,
      help: this._cmd_help,
      clear: this._cmd_clear,
      exit: this._cmd_exit,
      quit: this._cmd_quit,
    };
  }

  // --- navigation / inspection ---------------------------------------------
  _cmd_ls(args) {
    let showAll = false;
    let long = false;
    const paths = [];
    for (const a of args) {
      if (a.startsWith("-") && a.length > 1) {
        showAll = showAll || a.includes("a");
        long = long || a.includes("l");
      } else {
        paths.push(a);
      }
    }
    const path = paths.length ? paths[0] : "";
    const entries = this.fs.ls(path, showAll, long);
    return makeResult({ output: entries.length ? entries.join("\n") : "" });
  }

  _cmd_la(args) {
    return this._cmd_ls(["-a", ...args]);
  }

  _cmd_cd(args) {
    this.fs.cd(args.length ? args[0] : "");
    return makeResult({ output: "" });
  }

  _cmd_pwd() {
    return makeResult({ output: this.fs.pwd() });
  }

  _cmd_cat(args) {
    if (!args.length)
      return makeResult({ output: "cat: missing file operand", valid: false });
    return makeResult({ output: args.map((a) => this.fs.cat(a)).join("\n") });
  }

  _cmd_file(args) {
    if (!args.length)
      return makeResult({ output: "file: missing operand", valid: false });
    return makeResult({ output: this.fs.fileType(args[0]) });
  }

  _cmd_find(args) {
    const pattern = args.find((a) => !a.startsWith("-")) ?? "";
    return makeResult({ output: this.fs.find(pattern).join("\n") });
  }

  _cmd_grep(args) {
    let ignoreCase = false;
    let invert = false;
    let lineNumbers = false;
    const rest = [];
    for (const a of args) {
      if (a.startsWith("-") && a.length > 1 && !/^\d+$/.test(a.slice(1))) {
        for (const ch of a.slice(1)) {
          if (ch === "i") ignoreCase = true;
          else if (ch === "v") invert = true;
          else if (ch === "n") lineNumbers = true;
          // -r is implied (we always search the whole tree); ignore others.
        }
      } else {
        rest.push(a);
      }
    }
    if (!rest.length)
      return makeResult({ output: "grep: missing search pattern", valid: false });
    const pattern = rest[0];
    const path = rest.length > 1 ? rest[1] : "";
    const matches = this.fs.grep(pattern, path, ignoreCase, invert, lineNumbers);
    return makeResult({ output: matches.length ? matches.join("\n") : "" });
  }

  _cmd_tree() {
    const lines = [];
    for (const [path, node] of this.fs.walk()) {
      const depth = (path.match(/\//g) || []).length - 1;
      const prefix = "  ".repeat(depth) + "|- ";
      const label = node.name + (node.isDir ? "/" : "");
      lines.push(prefix + label);
    }
    return makeResult({ output: lines.join("\n") });
  }

  // --- decoding helpers ----------------------------------------------------
  _cmd_base64(args) {
    const decode = args.some((a) => a === "-d" || a === "--decode");
    const payload = args.filter((a) => !a.startsWith("-")).join(" ");
    if (!payload)
      return makeResult({ output: "base64: missing input", valid: false });
    try {
      const text = decode ? b64decode(payload + "===") : b64encode(payload);
      return makeResult({ output: text });
    } catch {
      return makeResult({ output: "base64: invalid input", valid: false });
    }
  }

  _cmd_rot13(args) {
    if (!args.length)
      return makeResult({ output: "rot13: missing input", valid: false });
    return makeResult({ output: rot13(args.join(" ")) });
  }

  _cmd_man(args) {
    if (!args.length)
      return makeResult({
        output: "man: what manual page do you want? e.g. `man ls`",
        valid: false,
      });
    return makeResult({ output: manText(args[0], GUIDES) });
  }

  // --- game verbs ----------------------------------------------------------
  _cmd_key(args) {
    if (!args.length)
      return makeResult({ output: "key: usage: key <VALUE>", valid: false });
    return makeResult({ submit_key: args[0], output: "" });
  }

  _cmd_unlock(args) {
    return this._cmd_key(args);
  }

  _cmd_hint() {
    return makeResult({ hint: true });
  }

  _cmd_help() {
    return makeResult({ output: HELP_TEXT });
  }

  _cmd_clear() {
    return makeResult({ cleared: true });
  }

  _cmd_exit() {
    return makeResult({ quit: true });
  }

  _cmd_quit() {
    return makeResult({ quit: true });
  }

  _unknown(cmd) {
    return makeResult({
      output: `${cmd}: command not found. Type 'help' to see what you can do.`,
      valid: false,
    });
  }
}
