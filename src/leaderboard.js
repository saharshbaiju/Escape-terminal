// Leaderboard client — talks to Supabase DIRECTLY from the browser (no backend).
//
// Mirrors escape_terminal/leaderboard: each run gets a client UUID (idempotency
// key / primary key), inserts are upserts on `id`, and Row Level Security
// (supabase/migrations/0001_init.sql) limits the anon key to INSERT + SELECT.
// When Supabase isn't configured or is unreachable, it falls back to a local
// (localStorage) board so the game still works offline.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL || "";
// Accept either the newer publishable key (sb_publishable_...) or the legacy
// anon key. Both are public client keys; RLS limits them to insert + read.
const KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "";
const TABLE = import.meta.env.VITE_SUPABASE_TABLE || "leaderboard";
const LS_KEY = "escape_terminal_runs";

const supabase = URL && KEY ? createClient(URL, KEY) : null;

export const leaderboardEnabled = Boolean(supabase);

export function makeRunRecord({
  name,
  score,
  outcome,
  levels_completed,
  total_seconds,
  details = null,
}) {
  return {
    id: crypto.randomUUID(),
    name,
    score,
    outcome,
    levels_completed,
    total_seconds: Math.round(total_seconds * 100) / 100,
    created_at: new Date().toISOString(),
    details, // jsonb: per-level time + split points (see game.details())
  };
}

// --- local cache (offline fallback) ---------------------------------------
function localRuns() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalRun(rec) {
  try {
    const runs = localRuns();
    if (!runs.some((r) => r.id === rec.id)) runs.push(rec);
    localStorage.setItem(LS_KEY, JSON.stringify(runs));
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
}

function sortBoard(rows) {
  return rows
    .slice()
    .sort((a, b) => b.score - a.score || a.total_seconds - b.total_seconds);
}

// --- public API ------------------------------------------------------------

// Persist a run locally (always) and try to push it to Supabase.
// Returns true if it reached the cloud, false if it was kept local only.
export async function submitRun(rec) {
  saveLocalRun(rec);
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(rec, { onConflict: "id", ignoreDuplicates: true });
    return !error;
  } catch {
    return false;
  }
}

// --- admin (password-gated server-side RPC, no service key in the browser) ---
// These call SECURITY DEFINER functions that check the password in the database
// and bypass RLS to delete. A wrong password makes the RPC error out.
export async function adminDeleteRun(password, id) {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_delete_run", {
    p_password: password,
    p_id: id,
  });
  return { ok: !error, error: error?.message, count: data };
}

export async function adminClearAll(password) {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_clear_all", {
    p_password: password,
  });
  return { ok: !error, error: error?.message, count: data };
}

// Live updates: call `cb` whenever any row changes. Returns a channel handle.
export function subscribeChanges(cb) {
  if (!supabase) return null;
  return supabase
    .channel("leaderboard-web")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, cb)
    .subscribe();
}

export function unsubscribe(channel) {
  if (channel && supabase) supabase.removeChannel(channel);
}

// Top scores. Tries Supabase, falls back to the local board offline.
export async function fetchLeaderboard(limit = 10) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("score", { ascending: false })
        .order("total_seconds", { ascending: true })
        .limit(limit);
      if (!error && data) return data;
    } catch {
      /* fall through to local */
    }
  }
  return sortBoard(localRuns()).slice(0, limit);
}
