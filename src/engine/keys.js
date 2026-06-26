// Per-playthrough key generation + content templating (port of engine/keys.py).
import { b64encode } from "./codecs.js";

// Unambiguous alphabet: no O/0, I/1/L — easy to read and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Crypto-random pick, matching Python's secrets.choice (uniform, unbiased).
function cryptoChoice(seq) {
  const max = Math.floor(0xffffffff / seq.length) * seq.length;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= max);
  return seq[x % seq.length];
}

export function generateKey(prefix = "ESCAPE", length = 5) {
  let suffix = "";
  for (let i = 0; i < length; i++) suffix += cryptoChoice(ALPHABET);
  return `${prefix}-${suffix}`;
}

export function keyTokens(key) {
  const phrase = `Final door key: ${key}`;
  return {
    KEY: key,
    KEY_PHRASE: phrase,
    KEY_PHRASE_B64: b64encode(phrase),
    KEY_B64: b64encode(key),
  };
}

// Recursively substitute {{TOKEN}} placeholders in string values.
export function render(obj, tokens) {
  if (Array.isArray(obj)) return obj.map((v) => render(v, tokens));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = render(v, tokens);
    return out;
  }
  if (typeof obj === "string") {
    let out = obj;
    // Longest token names first so {{KEY}} can't clobber {{KEY_PHRASE}}.
    const names = Object.keys(tokens).sort((a, b) => b.length - a.length);
    for (const name of names) {
      out = out.split("{{" + name + "}}").join(tokens[name]);
    }
    return out;
  }
  return obj;
}
