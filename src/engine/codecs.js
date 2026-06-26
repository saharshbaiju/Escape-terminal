// Small text codecs + a shell-style tokenizer, matching the Python stdlib
// behaviour the engine relies on (base64, rot_13, shlex.split).

const _utf8enc = new TextEncoder();
const _utf8dec = new TextDecoder("utf-8"); // non-fatal => U+FFFD on bad bytes

// base64-encode UTF-8 text (== Python base64.b64encode(s.encode()).decode()).
export function b64encode(text) {
  const bytes = _utf8enc.encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Decode base64, mimicking `base64.b64decode(payload + "===")` with the default
// validate=False: non-alphabet characters are discarded, then padding is fixed.
export function b64decode(payload) {
  const clean = payload.replace(/[^A-Za-z0-9+/]/g, "");
  // Re-pad to a multiple of 4 (atob is strict about padding; Python tolerates
  // the extra "===" the engine appends).
  let s = clean;
  while (s.length % 4 !== 0) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return _utf8dec.decode(bytes);
}

// ROT13 over ASCII letters (== Python codecs.encode(s, "rot_13")).
export function rot13(text) {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// Python str.splitlines(): split on newlines, dropping a single trailing empty
// element produced by a final line break (intermediate blanks are kept).
export function splitlines(s) {
  if (s === "") return [];
  const lines = s.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// A POSIX-ish shlex.split: handles single/double quotes and backslashes. On an
// unbalanced quote it throws, so the caller can fall back to whitespace split
// exactly like the Python interpreter does.
export function shlexSplit(input) {
  const out = [];
  let cur = "";
  let has = false;
  let i = 0;
  const n = input.length;
  let quote = null; // "'" or '"'
  while (i < n) {
    const ch = input[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < n && '"\\$`\n'.includes(input[i + 1])) {
        cur += input[i + 1];
        i++;
      } else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
    } else if (ch === "\\") {
      if (i + 1 < n) {
        cur += input[i + 1];
        i++;
      }
      has = true;
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
    i++;
  }
  if (quote !== null) throw new Error("No closing quotation");
  if (has) out.push(cur);
  return out;
}
