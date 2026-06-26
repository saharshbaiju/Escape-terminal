import { defineConfig } from "vite";

// Static SPA — builds to dist/, which Vercel serves directly. No server code.
// Supabase URL + anon key come from VITE_* env vars (see .env.example); they are
// PUBLIC by design (they ship in the browser bundle) — Row Level Security in
// supabase/migrations is what actually protects the data.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
