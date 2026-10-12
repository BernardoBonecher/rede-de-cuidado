// Domain types and the rules the screens are built on. No React, no Supabase: plain functions,
// so they are easy to test and shared by the live and the demo data stores.

export type Period = "manha" | "tarde" | "noite";
export const PERIODS: Period[] = ["manha", "tarde", "noite"];
export const PERIOD_LABEL: Record<Period, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };

export interface Circle { id: string; name: string; care_recipient: string; invite_code: string }
export interface Member { user_id: string; display_name: string; role: "admin" | "member" }
export interface Medication {
  id: string; name: string; dose: string; times: string[]; instructions: string | null; active: boolean;
}
export interface DoseLog {
  id: string; medication_id: string; day: string; slot: string; given_at: string; given_by: string | null;
}
export interface Shift { id: string; day: string; period: Period; user_id: string | null }
export interface Task {
  id: string; title: string; due_at: string | null; assignee: string | null;
  done_at: string | null; done_by: string | null; created_at: string;
}

/** Everything one circle needs on screen, loaded at once. */
export interface Snapshot {
  me: string;
  circle: Circle;
  members: Member[];
  medications: Medication[];
  doses: DoseLog[];   // today's
  shifts: Shift[];    // today and the next 6 days
  tasks: Task[];
}

// ---------- errors the UI explains in plain language ----------

/** Someone else already marked this dose. */
export class DoseTakenError extends Error {
  constructor(public log: DoseLog) { super("dose already given"); }
}
/** Someone else took this shift first. */
export class ShiftTakenError extends Error {
  constructor(public shift: Shift) { super("shift already taken"); }
}

// ---------- dates (always the device's local day) ----------

export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

/** "08:00:00" or "08:00" -> "08:00" */
export const hhmm = (slot: string) => slot.slice(0, 5);

export function minutesOf(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function dayLabel(day: string, today: string): string {
  if (day === today) return "Hoje";
  if (day === addDays(today, 1)) return "Amanhã";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAY[date.getDay()];
  return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${d}/${String(m).padStart(2, "0")}`;
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ---------- doses ----------

/** How long before the scheduled time a dose counts as "now", and after it as still on time. */
export const DUE_BEFORE_MIN = 30;
export const LATE_AFTER_MIN = 60;

export type DoseStatus = "given" | "late" | "due" | "upcoming";

export interface DoseRow {
  key: string;
  medication: Medication;
  slot: string;          // "08:00"
  status: DoseStatus;
  log: DoseLog | null;
}

/** Today's doses in time order, each with its status at `nowMin` (minutes since midnight). */
export function doseSchedule(medications: Medication[], logs: DoseLog[], nowMin: number): DoseRow[] {
  const byKey = new Map(logs.map((l) => [`${l.medication_id}@${hhmm(l.slot)}`, l]));
  const rows: DoseRow[] = [];
  for (const med of medications) {
    if (!med.active) continue;
    for (const t of med.times) {
      const slot = hhmm(t);
      const log = byKey.get(`${med.id}@${slot}`) ?? null;
      const at = minutesOf(slot);
      const status: DoseStatus = log ? "given"
        : nowMin > at + LATE_AFTER_MIN ? "late"
        : nowMin >= at - DUE_BEFORE_MIN ? "due"
        : "upcoming";
      rows.push({ key: `${med.id}@${slot}`, medication: med, slot, status, log });
    }
  }
  return rows.sort((a, b) => minutesOf(a.slot) - minutesOf(b.slot) || a.medication.name.localeCompare(b.medication.name));
}

export function doseSummary(rows: DoseRow[]) {
  const count = (s: DoseStatus) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, given: count("given"), late: count("late"), due: count("due") };
}

// ---------- shifts ----------

export interface ShiftCell { day: string; period: Period; user_id: string | null }

/** Every (day, period) for `days` days from `start`, filled from the stored shifts. */
export function shiftGrid(shifts: Shift[], start: string, days = 7): ShiftCell[][] {
  const stored = new Map(shifts.map((s) => [`${s.day}/${s.period}`, s.user_id]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(start, i);
    return PERIODS.map((period) => ({ day, period, user_id: stored.get(`${day}/${period}`) ?? null }));
  });
}

export function openShifts(grid: ShiftCell[][]): number {
  return grid.flat().filter((c) => !c.user_id).length;
}

// ---------- tasks ----------

/** Open tasks first (soonest due date first, undated last), then the most recently done. */
export function sortTasks(tasks: Task[]): { open: Task[]; done: Task[] } {
  const open = tasks.filter((t) => !t.done_at).sort((a, b) =>
    (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.created_at.localeCompare(b.created_at));
  const done = tasks.filter((t) => t.done_at).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
  return { open, done };
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return !task.done_at && !!task.due_at && new Date(task.due_at) < now;
}

// ---------- people ----------

export function nameOf(members: Member[], userId: string | null, me?: string): string {
  if (!userId) return "alguém que saiu da família";
  if (userId === me) return "você";
  return members.find((m) => m.user_id === userId)?.display_name ?? "alguém";
}

// ---------- validation ----------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parses "8:00, 20:00" into sorted unique "HH:MM" times, or returns an error message. */
export function parseTimes(input: string): { times: string[] } | { error: string } {
  const parts = input.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean)
    .map((p) => (/^\d:\d\d$/.test(p) ? `0${p}` : p));
  if (!parts.length) return { error: "Informe pelo menos um horário, como 08:00." };
  const bad = parts.find((p) => !TIME.test(p));
  if (bad) return { error: `"${bad}" não é um horário válido. Use o formato 08:00.` };
  const times = [...new Set(parts)].sort();
  if (times.length > 8) return { error: "No máximo 8 horários por remédio." };
  return { times };
}
