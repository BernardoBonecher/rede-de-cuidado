import type { Medication, Period, Snapshot, Task } from "../domain";

/**
 * What the screens need from a backend. Two implementations:
 * - LiveStore: Supabase (auth, Postgres with Row Level Security, realtime)
 * - DemoStore: in memory with a fictional family, for the public demo (no account, no backend)
 */
export interface Store {
  readonly mode: "live" | "demo";

  currentUser(): Promise<{ id: string; email: string } | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  /** The circle the user belongs to, or null if they still need to create or join one. */
  myCircleId(): Promise<string | null>;
  createCircle(name: string, recipient: string, displayName: string): Promise<string>;
  /** Throws InvalidCodeError when the code doesn't exist. */
  joinCircle(code: string, displayName: string): Promise<string>;

  load(circleId: string, today: string): Promise<Snapshot>;

  /** Throws DoseTakenError if someone else already marked this dose. */
  giveDose(circleId: string, medicationId: string, day: string, slot: string): Promise<void>;
  undoDose(logId: string): Promise<void>;

  /** Throws ShiftTakenError if someone else took it first. */
  takeShift(circleId: string, day: string, period: Period): Promise<void>;
  releaseShift(circleId: string, day: string, period: Period): Promise<void>;

  addTask(circleId: string, task: { title: string; due_at: string | null; assignee: string | null }): Promise<void>;
  setTaskDone(task: Task, done: boolean): Promise<void>;

  saveMedication(circleId: string, med: Omit<Medication, "id" | "active"> & { id?: string }): Promise<void>;
  archiveMedication(id: string): Promise<void>;

  regenerateInvite(circleId: string): Promise<string>;

  /** Calls onChange when someone else in the circle changes something. Returns an unsubscribe function. */
  subscribe(circleId: string, onChange: () => void): () => void;
}

export class InvalidCodeError extends Error {
  constructor() { super("invalid invite code"); }
}
