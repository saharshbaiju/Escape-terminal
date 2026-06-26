# Escape the Terminal — Web build

A mobile-friendly browser version of the game, with the **same puzzles, scoring,
and CRT look** as the TUI. The game engine is a faithful JavaScript port of
`escape_terminal/engine/` (verified byte-for-byte against the Python engine — see
[Parity](#parity)). The leaderboard talks to **Supabase directly from the
browser**, so there is **no backend** — this deploys to Vercel as a static site.

```
webapp/
  index.html            CRT shell
  src/
    main.js             UI controller (screens, HUD, tab-complete, quick-keys)
    style.css           green-phosphor CRT theme, responsive
    leaderboard.js      Supabase (direct) + offline localStorage fallback
    engine/             ← JS port of the Python engine
      content.json      generated from escape_terminal/content/*.yaml
      data.js keys.js codecs.js vfs.js scoring.js interpreter.js game.js
    ui/art.js           ASCII banner/art (generated from the TUI)
```

## Run locally

```bash
cd webapp
npm install
npm run dev          # http://localhost:5173
```

The game runs fully without Supabase (it falls back to a local, per-device
leaderboard). To test cloud sync locally, copy `.env.example` to `.env.local`
and fill in your Supabase values.

## Deploy to Vercel (no backend)

1. Push this repo to GitHub.
2. In Vercel: **New Project** → import the repo → set **Root Directory** to
   `webapp`. Framework preset auto-detects **Vite** (`vercel.json` also pins it).
3. Add **Environment Variables** (Project → Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | your **publishable** key (`sb_publishable_…`) — or use `VITE_SUPABASE_ANON_KEY` with the legacy anon key |
   | `VITE_SUPABASE_TABLE` | `leaderboard` (optional, this is the default) |

4. Deploy. Done — it's a static site, nothing else to run.

> **About `.env` and Vercel:** `VITE_*` vars are baked into the browser bundle at
> build time. That's fine here — the Supabase **URL + anon key are public by
> design**. What protects your data is **Row Level Security**, not secrecy of the
> key. The anon key can only `INSERT` a run and `SELECT` the board; it cannot
> update or delete scores. Never put a service-role key in a `VITE_*` var.

## Supabase setup

Run the existing schema once (it already has the right table + RLS):
`supabase/migrations/0001_init.sql` (repo root) — paste it into the Supabase SQL
editor, or `supabase db push`. The web client uses the same table and the same
client-generated UUID idempotency key as the desktop app, so both can share one
leaderboard.

## Keeping content in sync with the TUI

Puzzles live in `escape_terminal/content/*.yaml` (single source of truth). After
editing them, regenerate the web copy from the repo root:

```bash
.venv/bin/python -c "import json,yaml,pathlib; b=pathlib.Path('escape_terminal/content'); \
print(json.dumps({f: yaml.safe_load((b/f'{f}.yaml').read_text()) for f in ['levels','commands','easter_eggs']}, indent=2, ensure_ascii=False))" \
> webapp/src/engine/content.json
```

(The ASCII banner in `src/ui/art.js` is likewise generated from
`escape_terminal/ui/screens.py`.)

## Parity

`test/parity.js` (JS) and `test/parity_py.py` (Python) run identical command
sequences with a pinned key and dump JSON. To re-verify after engine changes:

```bash
cd webapp
npx esbuild test/parity.js --bundle --format=esm --platform=node --outfile=/tmp/parity.mjs
node /tmp/parity.mjs > /tmp/js.json
(cd test && ../../.venv/bin/python parity_py.py) > /tmp/py.json
diff /tmp/py.json /tmp/js.json && echo IDENTICAL
```

## Notes

- The admin console (live deadline/score editing, remote deletes) is **not**
  ported — it needs the service-role key, which must never ship to a browser.
  Operate it from the desktop TUI (`f2`).
- Mobile affordances added over the TUI: a quick-key bar (TAB, common commands,
  history ↑), tap-to-complete, and a collapsible field-guide drawer instead of a
  side panel.
