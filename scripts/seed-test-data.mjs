// Seed the test accounts through the public API (the same path the app uses), so seeding also
// proves that sign-in, the RPCs and Row Level Security work end to end.
//
//   node scripts/seed-test-data.mjs
//
// Needs .env.local with TEST_<NAME>_EMAIL / TEST_<NAME>_PASSWORD for ana, bruno and carla
// (accounts are created by the project owner; sign-ups are closed). Safe to re-run: it stops if
// Ana already belongs to a circle.

import { api, signIn } from "./rest.mjs";

// local calendar day (toISOString would give the UTC day, wrong near midnight in Brazil)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const ana = await signIn("ANA");
const bruno = await signIn("BRUNO");
const carla = await signIn("CARLA");
console.log("signed in: ana, bruno, carla");

if ((await api(ana, "members?select=circle_id")).length) {
  console.log("Ana already has a circle; nothing to do.");
  process.exit(0);
}

// Circle A: Ana creates it, Bruno joins with the invite code
const lucia = await api(ana, "rpc/create_circle", {
  method: "POST", body: { p_name: "Cuidado da Dona Lúcia", p_recipient: "Dona Lúcia", p_display_name: "Ana" },
});
const [{ invite_code }] = await api(ana, `circles?id=eq.${lucia}&select=invite_code`);
await api(bruno, "rpc/join_circle", { method: "POST", body: { p_code: invite_code, p_display_name: "Bruno" } });

const meds = await api(ana, "medications", {
  method: "POST",
  body: [
    { circle_id: lucia, name: "Losartana", dose: "50 mg, 1 comprimido", times: ["08:00", "20:00"], instructions: null },
    { circle_id: lucia, name: "Metformina", dose: "500 mg, 1 comprimido", times: ["08:00", "13:00", "20:00"],
      instructions: "Junto com a refeição" },
    { circle_id: lucia, name: "Vitamina D", dose: "7 gotas", times: ["12:00"], instructions: null },
  ],
});

const people = [ana.id, bruno.id, null];
await api(ana, "shifts", {
  method: "POST",
  body: [0, 1, 2, 3, 4, 5, 6].flatMap((d) => ["manha", "tarde", "noite"].map((period, p) => ({
    circle_id: lucia, day: iso(addDays(d)), period,
    user_id: people[(d + p) % 3],   // some slots stay empty on purpose: the app shows the gaps
  }))),
});

await api(ana, "tasks", {
  method: "POST",
  // PostgREST bulk inserts need the same keys in every object
  body: [
    { title: "Levar à consulta da cardiologista", due_at: `${iso(addDays(2))}T10:30:00-03:00`, assignee: bruno.id, done_at: null, done_by: null },
    { title: "Comprar fraldas geriátricas (tamanho M)", due_at: null, assignee: null, done_at: null, done_by: null },
    { title: "Renovar a receita da Losartana", due_at: null, assignee: null, done_at: new Date().toISOString(), done_by: ana.id },
  ].map((t) => ({ circle_id: lucia, ...t })),
});

await api(ana, "dose_logs", {
  method: "POST",
  body: { circle_id: lucia, medication_id: meds[0].id, day: iso(new Date()), slot: "08:00" },
});

// Circle B: Carla's family, used to prove that families can't see each other
const antonio = await api(carla, "rpc/create_circle", {
  method: "POST", body: { p_name: "Cuidado do Seu Antônio", p_recipient: "Seu Antônio", p_display_name: "Carla" },
});
await api(carla, "medications", {
  method: "POST", body: { circle_id: antonio, name: "Sinvastatina", dose: "20 mg", times: ["21:00"] },
});

console.log("seeded: Dona Lúcia (Ana admin, Bruno member), Seu Antônio (Carla)");
