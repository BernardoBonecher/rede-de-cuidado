import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { DoseTakenError, ShiftTakenError, addDays, type DoseLog, type Shift, type Snapshot } from "../domain";
import { InvalidCodeError, type Store } from "./store";

// Publishable key: designed to live in client code. Access to data is enforced by Row Level
// Security in Postgres (see supabase/migrations), not by keeping this key secret.
const SUPABASE_URL = "https://sjljwthvfmlcvplrnpbo.supabase.co";
const SUPABASE_KEY = "sb_publishable__ViQ0xa4LL9goEyn4rtR3g_r7i9o4OH";

const UNIQUE_VIOLATION = "23505";

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export class LiveStore implements Store {
  readonly mode = "live" as const;
  private db: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.db = client ?? createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  private async uid(): Promise<string> {
    const { data } = await this.db.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("not signed in");
    return id;
  }

  async currentUser() {
    const { data } = await this.db.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? "" } : null;
  }

  async signIn(email: string, password: string) {
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.status === 400 ? "E-mail ou senha incorretos." : error.message);
  }

  async signOut() {
    await this.db.auth.signOut();
  }

  async myCircleId() {
    const rows = check(await this.db.from("members").select("circle_id").limit(1));
    return rows?.[0]?.circle_id ?? null;
  }

  async createCircle(name: string, recipient: string, displayName: string) {
    return check(await this.db.rpc("create_circle", { p_name: name, p_recipient: recipient, p_display_name: displayName })) as string;
  }

  async joinCircle(code: string, displayName: string) {
    const res = await this.db.rpc("join_circle", { p_code: code, p_display_name: displayName });
    if (res.error?.message.includes("invalid invite code")) throw new InvalidCodeError();
    return check(res) as string;
  }

  async load(circleId: string, today: string): Promise<Snapshot> {
    const end = addDays(today, 6);
    const [me, circle, members, medications, doses, shifts, tasks] = await Promise.all([
      this.uid(),
      this.db.from("circles").select("id,name,care_recipient,invite_code").eq("id", circleId).single().then(check),
      this.db.from("members").select("user_id,display_name,role").eq("circle_id", circleId).order("joined_at").then(check),
      this.db.from("medications").select("id,name,dose,times,instructions,active").eq("circle_id", circleId).order("name").then(check),
      this.db.from("dose_logs").select("id,medication_id,day,slot,given_at,given_by").eq("circle_id", circleId).eq("day", today).then(check),
      this.db.from("shifts").select("id,day,period,user_id").eq("circle_id", circleId).gte("day", today).lte("day", end).then(check),
      this.db.from("tasks").select("id,title,due_at,assignee,done_at,done_by,created_at").eq("circle_id", circleId)
        .order("created_at", { ascending: false }).limit(100).then(check),
    ]);
    return { me, circle, members, medications, doses, shifts, tasks } as Snapshot;
  }

  async giveDose(circleId: string, medicationId: string, day: string, slot: string) {
    const res = await this.db.from("dose_logs").insert({ circle_id: circleId, medication_id: medicationId, day, slot });
    if (res.error?.code === UNIQUE_VIOLATION) {
      const existing = check(await this.db.from("dose_logs").select("*")
        .eq("medication_id", medicationId).eq("day", day).eq("slot", slot).single()) as DoseLog;
      throw new DoseTakenError(existing);
    }
    check(res);
  }

  async undoDose(logId: string) {
    check(await this.db.from("dose_logs").delete().eq("id", logId));
  }

  async takeShift(circleId: string, day: string, period: Shift["period"]) {
    const me = await this.uid();
    // Only claim a slot that is still free; if nobody created the row yet, insert it.
    const updated = check(await this.db.from("shifts").update({ user_id: me })
      .eq("circle_id", circleId).eq("day", day).eq("period", period).is("user_id", null).select("id"));
    if (updated?.length) return;
    const ins = await this.db.from("shifts").insert({ circle_id: circleId, day, period, user_id: me });
    if (ins.error?.code === UNIQUE_VIOLATION) {
      const taken = check(await this.db.from("shifts").select("id,day,period,user_id")
        .eq("circle_id", circleId).eq("day", day).eq("period", period).single()) as Shift;
      throw new ShiftTakenError(taken);
    }
    check(ins);
  }

  async releaseShift(circleId: string, day: string, period: Shift["period"]) {
    const me = await this.uid();
    check(await this.db.from("shifts").update({ user_id: null })
      .eq("circle_id", circleId).eq("day", day).eq("period", period).eq("user_id", me));
  }

  async addTask(circleId: string, task: { title: string; due_at: string | null; assignee: string | null }) {
    check(await this.db.from("tasks").insert({ circle_id: circleId, ...task }));
  }

  async setTaskDone(task: { id: string }, done: boolean) {
    const me = await this.uid();
    check(await this.db.from("tasks").update(done
      ? { done_at: new Date().toISOString(), done_by: me }
      : { done_at: null, done_by: null }).eq("id", task.id));
  }

  async saveMedication(circleId: string, med: { id?: string; name: string; dose: string; times: string[]; instructions: string | null }) {
    const { id, ...fields } = med;
    check(id
      ? await this.db.from("medications").update(fields).eq("id", id)
      : await this.db.from("medications").insert({ circle_id: circleId, ...fields }));
  }

  async archiveMedication(id: string) {
    check(await this.db.from("medications").update({ active: false }).eq("id", id));
  }

  async regenerateInvite(circleId: string) {
    return check(await this.db.rpc("regenerate_invite", { cid: circleId })) as string;
  }

  subscribe(circleId: string, onChange: () => void) {
    const channel = this.db.channel(`circle-${circleId}`);
    for (const table of ["dose_logs", "shifts", "tasks", "medications"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `circle_id=eq.${circleId}` }, onChange);
    }
    // Realtime can't filter DELETE events, so an undone dose would never arrive above. This
    // listener only carries the deleted row's id, no data; it just triggers a reload.
    channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "dose_logs" }, onChange);
    channel.subscribe();
    return () => { void this.db.removeChannel(channel); };
  }
}
