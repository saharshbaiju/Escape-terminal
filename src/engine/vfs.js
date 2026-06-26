// A tiny in-memory virtual filesystem (port of engine/vfs.py).
// POSIX-ish paths ('/', '.', '..'). Names starting with '.' are hidden.
import { splitlines } from "./codecs.js";

export class FSError extends Error {}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

class Node {
  constructor(name, isDir, content = "") {
    this.name = name;
    this.isDir = isDir;
    this.content = content;
    this.children = {}; // name -> Node
    this.parent = null;
  }
  get hidden() {
    return this.name.startsWith(".");
  }
  add(node) {
    node.parent = this;
    this.children[node.name] = node;
    return node;
  }
  childValues() {
    return Object.values(this.children).sort(byName);
  }
}

export class VirtualFS {
  constructor() {
    this.root = new Node("/", true);
    this.cwd = this.root;
  }

  static fromDict(tree, startDir = "/") {
    const fs = new VirtualFS();
    VirtualFS._populate(fs.root, tree);
    if (startDir !== "/") fs.cwd = fs._resolve(startDir, true);
    return fs;
  }

  static _populate(parent, tree) {
    for (const [name, value] of Object.entries(tree)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const node = parent.add(new Node(name, true));
        VirtualFS._populate(node, value);
      } else {
        parent.add(new Node(name, false, String(value)));
      }
    }
  }

  _resolve(path, mustBeDir = false) {
    let node = path.startsWith("/") ? this.root : this.cwd;
    const parts = path.split("/").filter((p) => p !== "" && p !== ".");
    for (const part of parts) {
      if (part === "..") {
        node = node.parent || node;
        continue;
      }
      if (!node.isDir) throw new FSError(`not a directory: ${node.name}`);
      if (!(part in node.children))
        throw new FSError(`no such file or directory: ${part}`);
      node = node.children[part];
    }
    if (mustBeDir && !node.isDir) throw new FSError(`not a directory: ${path}`);
    return node;
  }

  pathOf(node) {
    const parts = [];
    while (node && node !== this.root) {
      parts.push(node.name);
      node = node.parent;
    }
    return "/" + parts.reverse().join("/");
  }

  pwd() {
    return this.pathOf(this.cwd);
  }

  cd(path) {
    if (!path) {
      this.cwd = this.root;
      return;
    }
    this.cwd = this._resolve(path, true);
  }

  ls(path = "", showAll = false, long = false) {
    const node = path ? this._resolve(path) : this.cwd;
    if (!node.isDir) return [node.name];
    const out = [];
    for (const child of node.childValues()) {
      if (child.hidden && !showAll) continue;
      const label = child.name + (child.isDir ? "/" : "");
      if (long) {
        const kind = child.isDir ? "d" : "-";
        const size = String(child.content.length).padStart(5);
        out.push(`${kind}rw-r--r--  ${size}  ${label}`);
      } else {
        out.push(label);
      }
    }
    return out;
  }

  // (name, isDir) pairs for a directory's children — used by tab completion.
  entries(path = "", showAll = false) {
    const node = path ? this._resolve(path) : this.cwd;
    if (!node.isDir) return [];
    const out = [];
    for (const child of node.childValues()) {
      if (child.hidden && !showAll) continue;
      out.push([child.name, child.isDir]);
    }
    return out;
  }

  cat(path) {
    const node = this._resolve(path);
    if (node.isDir) throw new FSError(`is a directory: ${path}`);
    return node.content;
  }

  fileType(path) {
    const node = this._resolve(path);
    return node.isDir ? `${path}: directory` : `${path}: ASCII text`;
  }

  walk() {
    const results = [];
    const rec = (node) => {
      for (const child of node.childValues()) {
        results.push([this.pathOf(child), child]);
        if (child.isDir) rec(child);
      }
    };
    rec(this.root);
    return results;
  }

  find(pattern = "", showHidden = true) {
    const out = [];
    for (const [path, node] of this.walk()) {
      if (node.hidden && !showHidden) continue;
      if (!pattern || node.name.includes(pattern)) out.push(path);
    }
    return out;
  }

  grep(pattern, path = "", ignoreCase = false, invert = false, lineNumbers = false) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    const out = [];
    const all = this.walk();
    const targets = !path
      ? all
      : all.filter(
          ([p]) => p === path || p.startsWith(path.replace(/\/+$/, "") + "/"),
        );
    for (const [p, node] of targets) {
      if (node.isDir) continue;
      const lines = splitlines(node.content);
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const hay = ignoreCase ? line.toLowerCase() : line;
        let matched = hay.includes(needle);
        if (invert) matched = !matched;
        if (matched) {
          out.push(lineNumbers ? `${p}:${idx + 1}:${line}` : `${p}:${line}`);
        }
      }
    }
    return out;
  }
}
