// The demo must follow the same rules as the database, or the public demo would show behavior the
// real app doesn't have. These mirror supabase/tests/rls.test.mjs where it applies.
import { DoseTakenError, ShiftTakenError, localDay } from "../domain";
import { DemoStore } from "./demo";
import { InvalidCodeError } from "./store";

const today = localDay();
const fresh = () => new DemoStore(false, today);

test("a dose can be marked only once", async () => {
  const s = fresh();
  await s.giveDose("c", "med-vitd", today, "12:00");
  await expect(s.giveDose("c", "med-vitd", today, "12:00:00")).rejects.toBeInstanceOf(DoseTakenError);
  const snap = await s.load("c", today);
  expect(snap.doses.filter((d) => d.medication_id === "med-vitd")).toHaveLength(1);
});

test("you can undo your own dose, not someone else's", async () => {
  const s = fresh();
  await s.giveDose("c", "med-vitd", today, "12:00");
  await s.giveDose("c", "med-losartana", today, "20:00", "demo-bruno");
  let snap = await s.load("c", today);
  for (const d of snap.doses) await s.undoDose(d.id);
  snap = await s.load("c", today);
  expect(snap.doses.map((d) => d.given_by)).toEqual(expect.not.arrayContaining(["demo-ana"]));
  expect(snap.doses.some((d) => d.given_by === "demo-bruno" && d.medication_id === "med-losartana")).toBe(true);
});

test("a shift someone else holds can't be taken; a free one can, and released", async () => {
  const s = fresh();
  const snap = await s.load("c", today);
  const brunos = snap.shifts.find((x) => x.user_id === "demo-bruno")!;
  await expect(s.takeShift("c", brunos.day, brunos.period)).rejects.toBeInstanceOf(ShiftTakenError);

  const free = snap.shifts.find((x) => !x.user_id)!;
  await s.takeShift("c", free.day, free.period);
  expect((await s.load("c", today)).shifts.find((x) => x.id === free.id)?.user_id).toBe("demo-ana");
  await s.releaseShift("c", free.day, free.period);
  expect((await s.load("c", today)).shifts.find((x) => x.id === free.id)?.user_id).toBeNull();
});

test("wrong invite code is refused", async () => {
  await expect(fresh().joinCircle("NOPE1234", "x")).rejects.toBeInstanceOf(InvalidCodeError);
});

test("load returns a copy: screens can't mutate the store by accident", async () => {
  const s = fresh();
  const snap = await s.load("c", today);
  snap.medications[0].name = "changed";
  expect((await s.load("c", today)).medications[0].name).not.toBe("changed");
});

test("archiving a medication keeps it out of the active list", async () => {
  const s = fresh();
  await s.archiveMedication("med-vitd");
  const meds = (await s.load("c", today)).medications;
  expect(meds.find((m) => m.id === "med-vitd")?.active).toBe(false);
});
