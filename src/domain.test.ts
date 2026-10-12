import {
  DUE_BEFORE_MIN, LATE_AFTER_MIN, addDays, dayLabel, doseSchedule, doseSummary, isOverdue, minutesOf, nameOf,
  openShifts, parseTimes, shiftGrid, sortTasks, type DoseLog, type Medication, type Task,
} from "./domain";

const med = (over: Partial<Medication> = {}): Medication => ({
  id: "m1", name: "Losartana", dose: "50 mg", times: ["08:00:00", "20:00:00"], instructions: null, active: true, ...over,
});
const log = (over: Partial<DoseLog> = {}): DoseLog => ({
  id: "l1", medication_id: "m1", day: "2026-10-12", slot: "08:00:00", given_at: "2026-10-12T11:04:00Z", given_by: "u1", ...over,
});

describe("doseSchedule", () => {
  const at = (hhmm: string) => minutesOf(hhmm);

  test("one row per medication per time, in time order", () => {
    const rows = doseSchedule([med(), med({ id: "m2", name: "Metformina", times: ["13:00"] })], [], at("07:00"));
    expect(rows.map((r) => `${r.slot} ${r.medication.name}`)).toEqual(["08:00 Losartana", "13:00 Metformina", "20:00 Losartana"]);
  });

  test("status boundaries around the scheduled time", () => {
    const status = (now: string) => doseSchedule([med({ times: ["08:00"] })], [], at(now))[0].status;
    expect(status("07:29")).toBe("upcoming");
    expect(status("07:30")).toBe("due");                        // DUE_BEFORE_MIN before
    expect(status("09:00")).toBe("due");                        // exactly LATE_AFTER_MIN after: still on time
    expect(status("09:01")).toBe("late");
    expect(DUE_BEFORE_MIN).toBe(30);
    expect(LATE_AFTER_MIN).toBe(60);
  });

  test("a logged dose is given, whatever the time, and matches HH:MM with or without seconds", () => {
    const rows = doseSchedule([med()], [log({ slot: "08:00" })], at("22:00"));
    expect(rows.map((r) => r.status)).toEqual(["given", "late"]);
    expect(rows[0].log?.id).toBe("l1");
  });

  test("archived medications don't appear", () => {
    expect(doseSchedule([med({ active: false })], [], at("08:00"))).toEqual([]);
  });

  test("summary counts", () => {
    const rows = doseSchedule([med()], [log()], at("21:30"));
    expect(doseSummary(rows)).toEqual({ total: 2, given: 1, late: 1, due: 0 });
  });
});

describe("shifts", () => {
  test("grid fills 7 days x 3 periods and counts the open ones", () => {
    const grid = shiftGrid([{ id: "s", day: "2026-10-13", period: "tarde", user_id: "u1" }], "2026-10-12", 7);
    expect(grid).toHaveLength(7);
    expect(grid[1][1]).toEqual({ day: "2026-10-13", period: "tarde", user_id: "u1" });
    expect(openShifts(grid)).toBe(20);
  });

  test("days roll over months", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(dayLabel("2026-10-13", "2026-10-12")).toBe("Amanhã");
    expect(dayLabel("2026-10-14", "2026-10-12")).toBe("Quarta, 14/10");
  });
});

describe("tasks", () => {
  const task = (over: Partial<Task>): Task => ({
    id: "t", title: "x", due_at: null, assignee: null, done_at: null, done_by: null, created_at: "2026-10-01T00:00:00Z", ...over,
  });

  test("open tasks by due date with undated last; done tasks newest first", () => {
    const { open, done } = sortTasks([
      task({ id: "undated" }),
      task({ id: "later", due_at: "2026-10-20T10:00:00Z" }),
      task({ id: "sooner", due_at: "2026-10-14T10:00:00Z" }),
      task({ id: "done-old", done_at: "2026-10-01T10:00:00Z", done_by: "u" }),
      task({ id: "done-new", done_at: "2026-10-10T10:00:00Z", done_by: "u" }),
    ]);
    expect(open.map((t) => t.id)).toEqual(["sooner", "later", "undated"]);
    expect(done.map((t) => t.id)).toEqual(["done-new", "done-old"]);
  });

  test("overdue only when open and past due", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(isOverdue(task({ due_at: "2026-10-11T12:00:00Z" }), now)).toBe(true);
    expect(isOverdue(task({ due_at: "2026-10-11T12:00:00Z", done_at: "x", done_by: "u" }), now)).toBe(false);
    expect(isOverdue(task({}), now)).toBe(false);
  });
});

describe("people and input", () => {
  test("names: you, a member, someone who left", () => {
    const members = [{ user_id: "u2", display_name: "Bruno", role: "member" as const }];
    expect(nameOf(members, "u1", "u1")).toBe("você");
    expect(nameOf(members, "u2", "u1")).toBe("Bruno");
    expect(nameOf(members, null, "u1")).toBe("alguém que saiu da família");
  });

  test("parseTimes accepts loose input and rejects nonsense", () => {
    expect(parseTimes("20:00, 8:00; 08:00")).toEqual({ times: ["08:00", "20:00"] });
    expect(parseTimes("25:00")).toEqual({ error: '"25:00" não é um horário válido. Use o formato 08:00.' });
    expect("error" in parseTimes("")).toBe(true);
    expect("error" in parseTimes("01:00 02:00 03:00 04:00 05:00 06:00 07:00 08:00 09:00")).toBe(true);
  });
});
