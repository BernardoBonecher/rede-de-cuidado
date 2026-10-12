// Row Level Security tests against the live project, through the same REST API the app uses.
// Each test acts as a real test account and checks what it can and cannot see or change.
//
//   node --test supabase/tests/
//
// Needs .env.local with the test accounts (see README). Skipped when it's missing.
// Tests that write clean up after themselves.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { api, call, hasTestAccounts, signIn } from "../../scripts/rest.mjs";

const today = new Date().toISOString().slice(0, 10);

describe("Row Level Security", { skip: !hasTestAccounts && "no .env.local with test accounts" }, () => {
  let ana, bruno, carla, lucia, antonio, losartana;
  const cleanup = [];

  before(async () => {
    [ana, bruno, carla] = await Promise.all(["ANA", "BRUNO", "CARLA"].map(signIn));
    [{ circle_id: lucia }] = await api(ana, "members?select=circle_id");
    [{ circle_id: antonio }] = await api(carla, "members?select=circle_id");
    [losartana] = await api(ana, `medications?circle_id=eq.${lucia}&name=eq.Losartana&select=id,times`);
  });

  after(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  // ---------- isolation between families ----------

  test("a family sees only its own circle, people, medications and doses", async () => {
    for (const table of ["circles", "members", "medications", "dose_logs", "shifts", "tasks"]) {
      const rows = await api(carla, `${table}?select=*`);
      const leaked = rows.filter((r) => (r.circle_id ?? r.id) === lucia);
      assert.equal(leaked.length, 0, `Carla can see ${leaked.length} row(s) of Dona Lúcia's ${table}`);
    }
  });

  test("filtering by another family's id returns nothing instead of an error", async () => {
    assert.deepEqual(await api(carla, `medications?circle_id=eq.${lucia}`), []);
  });

  test("an outsider cannot write into another family", async () => {
    const res = await call(carla, "tasks", { method: "POST", body: { circle_id: lucia, title: "invasão" } });
    assert.equal(res.status, 403);
  });

  test("an outsider cannot change another family's data", async () => {
    const res = await call(carla, `medications?id=eq.${losartana.id}`, { method: "PATCH", body: { dose: "999 mg" } });
    assert.deepEqual(res.body, []);   // RLS hides the row, so nothing is updated
    const [med] = await api(ana, `medications?id=eq.${losartana.id}&select=dose`);
    assert.notEqual(med.dose, "999 mg");
  });

  test("anonymous visitors see nothing and cannot create a family", async () => {
    assert.deepEqual(await api(null, "medications?select=*"), []);
    const res = await call(null, "rpc/create_circle", {
      method: "POST", body: { p_name: "x", p_recipient: "x", p_display_name: "x" },
    });
    assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`);
  });

  // ---------- joining ----------

  test("a wrong invite code does not let anyone in", async () => {
    const res = await call(carla, "rpc/join_circle", { method: "POST", body: { p_code: "ZZZZZZZZ", p_display_name: "Carla" } });
    assert.equal(res.status, 404);
    assert.match(res.body.message, /invalid invite code/);
  });

  test("only an admin can change the invite code", async () => {
    const res = await call(bruno, "rpc/regenerate_invite", { method: "POST", body: { cid: lucia } });
    assert.equal(res.status, 403, `Bruno (member) regenerated the code: ${res.status}`);
  });

  test("a member cannot promote themselves to admin", async () => {
    const res = await call(bruno, `members?circle_id=eq.${lucia}&user_id=eq.${bruno.id}`, {
      method: "PATCH", body: { role: "admin" },
    });
    assert.ok(res.status >= 400, `role update returned ${res.status}`);
    const [me] = await api(bruno, `members?circle_id=eq.${lucia}&user_id=eq.${bruno.id}&select=role`);
    assert.equal(me.role, "member");
  });

  test("a member can rename themselves", async () => {
    await api(bruno, `members?circle_id=eq.${lucia}&user_id=eq.${bruno.id}`, { method: "PATCH", body: { display_name: "Bruno S." } });
    cleanup.push(() => api(bruno, `members?circle_id=eq.${lucia}&user_id=eq.${bruno.id}`, { method: "PATCH", body: { display_name: "Bruno" } }));
    const [me] = await api(bruno, `members?circle_id=eq.${lucia}&user_id=eq.${bruno.id}&select=display_name`);
    assert.equal(me.display_name, "Bruno S.");
  });

  // ---------- doses: the core product rule ----------

  test("a dose can be marked as given only once, and the family sees who gave it", async () => {
    const slot = "20:00";
    const dose = { circle_id: lucia, medication_id: losartana.id, day: today, slot };
    const [log] = await api(bruno, "dose_logs", { method: "POST", body: dose });
    cleanup.push(() => api(bruno, `dose_logs?id=eq.${log.id}`, { method: "DELETE" }));

    const second = await call(ana, "dose_logs", { method: "POST", body: dose });
    assert.equal(second.status, 409, "Ana could log the same dose again");

    const [seen] = await api(ana, `dose_logs?id=eq.${log.id}&select=given_by`);
    assert.equal(seen.given_by, bruno.id);
  });

  test("nobody can log a dose in someone else's name", async () => {
    const res = await call(bruno, "dose_logs", {
      method: "POST", body: { circle_id: lucia, medication_id: losartana.id, day: today, slot: "08:00", given_by: ana.id },
    });
    assert.ok(res.status === 403 || res.status === 409, `got ${res.status}`);
  });

  test("you can undo your own dose log but not someone else's", async () => {
    const [anasLog] = await api(ana, `dose_logs?circle_id=eq.${lucia}&day=eq.${today}&slot=eq.08:00:00&select=id,given_by`);
    assert.equal(anasLog.given_by, ana.id);
    const res = await call(bruno, `dose_logs?id=eq.${anasLog.id}`, { method: "DELETE" });
    assert.deepEqual(res.body, []);   // nothing deleted
    assert.equal((await api(ana, `dose_logs?id=eq.${anasLog.id}`)).length, 1);
  });

  test("a medication from one family cannot be logged under another", async () => {
    const res = await call(carla, "dose_logs", {
      method: "POST", body: { circle_id: antonio, medication_id: losartana.id, day: today, slot: "20:00" },
    });
    assert.ok(res.status >= 400, `cross-family dose accepted: ${res.status}`);
  });

  test("a shift can only be assigned to someone in the same family", async () => {
    const res = await call(ana, `shifts?circle_id=eq.${lucia}&day=eq.${today}&period=eq.manha`, {
      method: "PATCH", body: { user_id: carla.id },
    });
    assert.ok(res.status >= 400, `assigned an outsider to a shift: ${res.status}`);
  });
});
