import {
  DoseTakenError, ShiftTakenError, addDays, hhmm, localDay, minutesOf,
  type DoseLog, type Medication, type Member, type Period, type Shift, type Snapshot, type Task,
} from "../domain";
import { InvalidCodeError, type Store } from "./store";

// The public demo: a fictional family, kept in memory (and in localStorage, so a reload keeps your
// changes). It enforces the same rules as the database, so the screens behave the same way.

const ME = "demo-ana";
const BRUNO = "demo-bruno";
const CIRCLE = "demo-circle";
const STORAGE_KEY = "rede-de-cuidado-demo-v1";

interface State {
  day: string;
  invite: string;
  members: Member[];
  medications: Medication[];
  doses: DoseLog[];
  shifts: Shift[];
  tasks: Task[];
}

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function seedState(today: string, now = new Date()): State {
  const iso = (day: string, time: string) => new Date(`${day}T${time}:00`).toISOString();
  const medications: Medication[] = [
    { id: "med-losartana", name: "Losartana", dose: "50 mg, 1 comprimido", times: ["08:00", "20:00"], instructions: null, active: true },
    { id: "med-metformina", name: "Metformina", dose: "500 mg, 1 comprimido", times: ["08:00", "13:00", "20:00"], instructions: "Junto com a refeição", active: true },
    { id: "med-vitd", name: "Vitamina D", dose: "7 gotas", times: ["12:00"], instructions: null, active: true },
  ];
  // Morning doses already given, so the demo opens mid-day with history on screen.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const doses: DoseLog[] = nowMin > minutesOf("08:30") ? [
    { id: "dose-1", medication_id: "med-losartana", day: today, slot: "08:00", given_at: iso(today, "08:04"), given_by: BRUNO },
    { id: "dose-2", medication_id: "med-metformina", day: today, slot: "08:00", given_at: iso(today, "08:05"), given_by: BRUNO },
  ] : [];
  const who = [ME, BRUNO, null];
  const shifts: Shift[] = Array.from({ length: 7 }, (_, d) => (["manha", "tarde", "noite"] as Period[])
    .map((period, p) => ({ id: `shift-${d}-${p}`, day: addDays(today, d), period, user_id: who[(d + p) % 3] }))).flat();
  const tasks: Task[] = [
    { id: "task-1", title: "Levar à consulta da cardiologista", due_at: iso(addDays(today, 2), "10:30"), assignee: BRUNO,
      done_at: null, done_by: null, created_at: iso(addDays(today, -1), "09:00") },
    { id: "task-2", title: "Comprar fraldas geriátricas (tamanho M)", due_at: null, assignee: null,
      done_at: null, done_by: null, created_at: iso(addDays(today, -1), "09:05") },
    { id: "task-3", title: "Renovar a receita da Losartana", due_at: null, assignee: ME,
      done_at: iso(addDays(today, -1), "16:20"), done_by: ME, created_at: iso(addDays(today, -3), "11:00") },
  ];
  return {
    day: today,
    invite: "LUCIA7KM",
    members: [
      { user_id: ME, display_name: "Ana", role: "admin" },
      { user_id: BRUNO, display_name: "Bruno", role: "member" },
    ],
    medications, doses, shifts, tasks,
  };
}

export class DemoStore implements Store {
  readonly mode = "demo" as const;
  private state: State;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private persist = true, today = localDay()) {
    const saved = persist ? DemoStore.read() : null;
    // A new day starts from a fresh seed, so the demo never shows stale "late" doses from yesterday.
    this.state = saved && saved.day === today ? saved : seedState(today);
  }

  private static read(): State | null {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"); } catch { return null; }
  }

  private save() {
    if (this.persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* private mode: keep in memory */ }
    }
  }

  private changed() {
    this.save();
    for (const fn of this.listeners) fn();
  }

  reset() {
    this.state = seedState(localDay());
    this.changed();
  }

  async currentUser() { return { id: ME, email: "ana@exemplo" }; }
  async signIn() {}
  async signOut() {}
  async myCircleId() { return CIRCLE; }
  async createCircle() { return CIRCLE; }

  async joinCircle(code: string, _displayName?: string) {
    if (code.trim().toUpperCase() !== this.state.invite) throw new InvalidCodeError();
    return CIRCLE;
  }

  async load(_circleId: string, today: string): Promise<Snapshot> {
    const s = this.state;
    return structuredClone({
      me: ME,
      circle: { id: CIRCLE, name: "Cuidado da Dona Lúcia", care_recipient: "Dona Lúcia", invite_code: s.invite },
      members: s.members,
      medications: s.medications,
      doses: s.doses.filter((d) => d.day === today),
      shifts: s.shifts.filter((x) => x.day >= today && x.day <= addDays(today, 6)),
      tasks: s.tasks,
    });
  }

  async giveDose(_c: string, medicationId: string, day: string, slot: string, by = ME) {
    const existing = this.state.doses.find((d) => d.medication_id === medicationId && d.day === day && hhmm(d.slot) === hhmm(slot));
    if (existing) throw new DoseTakenError(structuredClone(existing));
    this.state.doses.push({ id: id("dose"), medication_id: medicationId, day, slot: hhmm(slot), given_at: new Date().toISOString(), given_by: by });
    this.changed();
  }

  async undoDose(logId: string) {
    const log = this.state.doses.find((d) => d.id === logId);
    if (!log || log.given_by !== ME) return;   // same rule as the database: only your own
    this.state.doses = this.state.doses.filter((d) => d.id !== logId);
    this.changed();
  }

  async takeShift(_c: string, day: string, period: Period, by = ME) {
    const shift = this.state.shifts.find((s) => s.day === day && s.period === period);
    if (shift?.user_id && shift.user_id !== by) throw new ShiftTakenError(structuredClone(shift));
    if (shift) shift.user_id = by;
    else this.state.shifts.push({ id: id("shift"), day, period, user_id: by });
    this.changed();
  }

  async releaseShift(_c: string, day: string, period: Period) {
    const shift = this.state.shifts.find((s) => s.day === day && s.period === period && s.user_id === ME);
    if (shift) { shift.user_id = null; this.changed(); }
  }

  async addTask(_c: string, task: { title: string; due_at: string | null; assignee: string | null }) {
    this.state.tasks.push({ id: id("task"), ...task, done_at: null, done_by: null, created_at: new Date().toISOString() });
    this.changed();
  }

  async setTaskDone(task: Task, done: boolean) {
    const t = this.state.tasks.find((x) => x.id === task.id);
    if (!t) return;
    t.done_at = done ? new Date().toISOString() : null;
    t.done_by = done ? ME : null;
    this.changed();
  }

  async saveMedication(_c: string, med: Omit<Medication, "id" | "active"> & { id?: string }) {
    const existing = med.id && this.state.medications.find((m) => m.id === med.id);
    if (existing) Object.assign(existing, { name: med.name, dose: med.dose, times: med.times, instructions: med.instructions });
    else this.state.medications.push({ ...med, id: id("med"), active: true });
    this.changed();
  }

  async archiveMedication(medId: string) {
    const m = this.state.medications.find((x) => x.id === medId);
    if (m) { m.active = false; this.changed(); }
  }

  async regenerateInvite() {
    this.state.invite = Array.from({ length: 8 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
    this.changed();
    return this.state.invite;
  }

  /**
   * In the demo, "Bruno" acts on his own once, about 25 seconds in: he marks the next due dose,
   * so the visitor sees another family member's change arrive without reloading.
   */
  subscribe(_c: string, onChange: () => void) {
    this.listeners.add(onChange);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.brunoActs(), 25_000);
    }
    return () => {
      this.listeners.delete(onChange);
      if (!this.listeners.size && this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    };
  }

  private async brunoActs() {
    const today = localDay();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const pending = this.state.medications.filter((m) => m.active)
      .flatMap((m) => m.times.map((t) => ({ m, t: hhmm(t) })))
      .filter(({ m, t }) => !this.state.doses.some((d) => d.medication_id === m.id && d.day === today && hhmm(d.slot) === t))
      .filter(({ t }) => minutesOf(t) <= nowMin + 30)
      .sort((a, b) => minutesOf(a.t) - minutesOf(b.t));
    const next = pending[0];
    if (next) await this.giveDose(CIRCLE, next.m.id, today, next.t, BRUNO).catch(() => {});
  }
}
