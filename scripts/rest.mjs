// Tiny client for the Supabase REST API, shared by the seed script and the RLS tests.
// Uses only fetch, so it runs on plain Node 18+ without installing anything.

import { existsSync, readFileSync } from "node:fs";

export const SUPABASE_URL = "https://sjljwthvfmlcvplrnpbo.supabase.co";
// Publishable key: meant for client code. Data is protected by Row Level Security, not by this key.
export const KEY = "sb_publishable__ViQ0xa4LL9goEyn4rtR3g_r7i9o4OH";

const ENV_FILE = new URL("../.env.local", import.meta.url);

export const hasTestAccounts = existsSync(ENV_FILE);

export const env = hasTestAccounts
  ? Object.fromEntries(
      readFileSync(ENV_FILE, "utf8")
        .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    )
  : {};

export async function signIn(name) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in ${name}: ${res.status} ${body.error_description ?? body.msg}`);
  return { token: body.access_token, id: body.user.id };
}

/** Raw call: returns { status, body } and never throws on HTTP errors. `user` may be null (anonymous). */
export async function call(user, path, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, "Content-Type": "application/json", Prefer: "return=representation",
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Like call(), but throws unless the request succeeded. */
export async function api(user, path, options) {
  const res = await call(user, path, options);
  if (res.status >= 300) throw new Error(`${options?.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
