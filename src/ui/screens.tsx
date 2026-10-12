import { useState, type FormEvent } from "react";
import {
  PERIOD_LABEL, dayLabel, doseSchedule, doseSummary, hhmm, isOverdue, nameOf, openShifts, parseTimes,
  shiftGrid, sortTasks, timeOf, type DoseRow, type Medication, type ShiftCell, type Snapshot, type Task,
} from "../domain";
import type { Store } from "../data/store";
import { Dot } from "./icons";
import { capitalize, type Act } from "./useCircle";

export interface ScreenProps {
  store: Store;
  snap: Snapshot;
  today: string;
  nowMin: number;
  act: Act;
  canWrite: boolean;
}

// ---------- Hoje ----------

const STATUS_PILL = {
  given: { cls: "ok", text: "Dado" },
  late: { cls: "late", text: "Atrasado" },
  due: { cls: "due", text: "Agora" },
  upcoming: { cls: "neutral", text: "Mais tarde" },
} as const;

function DoseItem({ row, p }: { row: DoseRow; p: ScreenProps }) {
  const { snap, store, today, act, canWrite } = p;
  const pill = STATUS_PILL[row.status];
  const med = row.medication;

  const give = () => act(
    () => store.giveDose(snap.circle.id, med.id, today, row.slot),
    `${med.name} das ${row.slot} marcado como dado.`,
    async () => {
      const fresh = await store.load(snap.circle.id, today);
      const log = fresh.doses.find((d) => d.medication_id === med.id && hhmm(d.slot) === row.slot && d.given_by === fresh.me);
      if (log) await store.undoDose(log.id);
    },
  );

  return (
    <li className={`dose is-${row.status}`}>
      <span className="time">{row.slot}</span>
      <span className="what">
        <b>{med.name}</b>
        <span>{med.dose}{med.instructions ? ` · ${med.instructions}` : ""}</span>
      </span>
      {row.log ? (
        <span className={`pill ${pill.cls}`}><Dot kind="ok" /> {pill.text}</span>
      ) : (
        <button className={`btn ${row.status === "upcoming" ? "secondary" : ""}`} onClick={give} disabled={!canWrite}
          aria-label={`Marcar ${med.name} das ${row.slot} como dado`}>
          Dei
        </button>
      )}
      <span className="meta">
        {row.log ? (
          <>
            <span>Por {nameOf(snap.members, row.log.given_by, snap.me)} às {timeOf(row.log.given_at)}</span>
            {row.log.given_by === snap.me && canWrite && (
              <button className="link small" onClick={() => act(() => store.undoDose(row.log!.id), "Marcação desfeita.")}>
                Desfazer
              </button>
            )}
          </>
        ) : row.status !== "upcoming" ? (
          <span className={`pill ${pill.cls}`}><Dot kind={row.status === "late" ? "late" : "due"} /> {pill.text}</span>
        ) : null}
      </span>
    </li>
  );
}

export function Today(p: ScreenProps) {
  const { snap, today, nowMin } = p;
  const rows = doseSchedule(snap.medications, snap.doses, nowMin);
  const sum = doseSummary(rows);
  const todayShifts = shiftGrid(snap.shifts, today, 1)[0];
  const { open } = sortTasks(snap.tasks);

  return (
    <>
      <div className="summary" role="group" aria-label="Resumo do dia">
        <div><b>{sum.given}/{sum.total}</b><span>doses dadas</span></div>
        <div><b>{sum.late}</b><span>{sum.late === 1 ? "dose atrasada" : "doses atrasadas"}</span></div>
        <div><b>{todayShifts.filter((c) => !c.user_id).length}</b><span>turnos sem ninguém hoje</span></div>
      </div>

      <section aria-labelledby="h-doses">
        <h2 id="h-doses">Remédios de hoje <span className="count">{sum.given} de {sum.total}</span></h2>
        <div className="card">
          {rows.length ? <ul className="list">{rows.map((r) => <DoseItem key={r.key} row={r} p={p} />)}</ul>
            : <p className="empty">Nenhum remédio cadastrado. Cadastre na aba Remédios.</p>}
        </div>
      </section>

      <section aria-labelledby="h-shift">
        <h2 id="h-shift">Quem está com {p.snap.circle.care_recipient} hoje</h2>
        <ShiftList cells={todayShifts} p={p} />
      </section>

      <section aria-labelledby="h-tasks">
        <h2 id="h-tasks">Próximas tarefas <a className="count" href="#tarefas">ver todas</a></h2>
        <div className="card">
          {open.length ? (
            <ul className="list">{open.slice(0, 3).map((t) => <TaskItem key={t.id} task={t} p={p} />)}</ul>
          ) : <p className="empty">Nenhuma tarefa aberta.</p>}
        </div>
      </section>
    </>
  );
}

// ---------- Agenda (plantões) ----------

function ShiftList({ cells, p, withDayHeads = false }: { cells: ShiftCell[]; p: ScreenProps; withDayHeads?: boolean }) {
  const { snap, store, act, canWrite, today } = p;
  let lastDay = "";
  return (
    <div className="card">
      <ul className="list">
        {cells.map((c) => {
          const head = withDayHeads && c.day !== lastDay ? (lastDay = c.day, dayLabel(c.day, today)) : null;
          const mine = c.user_id === snap.me;
          return [
            head && <li key={`h-${c.day}`} className="day-head" aria-hidden="true">{head}</li>,
            <li key={`${c.day}/${c.period}`} className="shift-row">
              <span className="who">
                <b>{withDayHeads && <span className="sr-only">{dayLabel(c.day, today)}, </span>}{PERIOD_LABEL[c.period]}</b>
                {c.user_id ? <span>{capitalize(nameOf(snap.members, c.user_id, snap.me))}</span>
                  : <span className="pill gap"><Dot kind="gap" /> Ninguém ainda</span>}
              </span>
              {!c.user_id ? (
                <button className="btn" disabled={!canWrite}
                  onClick={() => act(() => store.takeShift(snap.circle.id, c.day, c.period), `Você ficou com o turno da ${PERIOD_LABEL[c.period].toLowerCase()} de ${dayLabel(c.day, today).toLowerCase()}.`)}>
                  Eu cubro
                </button>
              ) : mine ? (
                <button className="btn secondary" disabled={!canWrite}
                  onClick={() => act(() => store.releaseShift(snap.circle.id, c.day, c.period), "Turno liberado para a família.")}>
                  Liberar
                </button>
              ) : null}
            </li>,
          ];
        })}
      </ul>
    </div>
  );
}

export function Agenda(p: ScreenProps) {
  const grid = shiftGrid(p.snap.shifts, p.today, 7);
  const gaps = openShifts(grid);
  return (
    <section aria-labelledby="h-agenda">
      <h2 id="h-agenda">Próximos 7 dias
        <span className="count">{gaps ? `${gaps} ${gaps === 1 ? "turno sem ninguém" : "turnos sem ninguém"}` : "tudo coberto"}</span>
      </h2>
      <ShiftList cells={grid.flat()} p={p} withDayHeads />
    </section>
  );
}

// ---------- Tarefas ----------

function TaskItem({ task, p }: { task: Task; p: ScreenProps }) {
  const { snap, store, act, canWrite } = p;
  const done = !!task.done_at;
  const id = `task-${task.id}`;
  return (
    <li className={`task ${done ? "done" : ""}`}>
      <input id={id} type="checkbox" checked={done} disabled={!canWrite}
        onChange={() => act(() => store.setTaskDone(task, !done), done ? "Tarefa reaberta." : "Tarefa concluída.")} />
      <label htmlFor={id}>
        <span className="title">{task.title}</span>
        <span className="small muted" style={{ display: "block" }}>
          {done ? `Feita por ${nameOf(snap.members, task.done_by, snap.me)}`
            : [task.assignee ? `Com ${nameOf(snap.members, task.assignee, snap.me)}` : "Sem responsável",
               task.due_at && `${new Date(task.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`]
              .filter(Boolean).join(" · ")}
          {isOverdue(task) && <> · <span className="pill late"><Dot kind="late" /> Atrasada</span></>}
        </span>
      </label>
    </li>
  );
}

export function Tasks(p: ScreenProps) {
  const { snap, store, act, canWrite } = p;
  const { open, done } = sortTasks(snap.tasks);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await act(() => store.addTask(snap.circle.id, {
      title: title.trim(), due_at: due ? new Date(due).toISOString() : null, assignee: assignee || null,
    }), "Tarefa criada.");
    if (ok) { setTitle(""); setDue(""); setAssignee(""); }
  }

  return (
    <>
      <section aria-labelledby="h-new-task">
        <h2 id="h-new-task">Nova tarefa</h2>
        <form className="card stack" style={{ padding: 16 }} onSubmit={submit}>
          <label className="field">O que precisa ser feito
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Ex.: buscar exame no laboratório" />
          </label>
          <label className="field">Quando <small>opcional</small>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">Quem vai fazer <small>opcional</small>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Ainda não sei</option>
              {snap.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === snap.me ? `${m.display_name} (você)` : m.display_name}</option>)}
            </select>
          </label>
          <button className="btn block" disabled={!canWrite || !title.trim()}>Adicionar tarefa</button>
        </form>
      </section>

      <section aria-labelledby="h-open">
        <h2 id="h-open">Abertas <span className="count">{open.length}</span></h2>
        <div className="card">
          {open.length ? <ul className="list">{open.map((t) => <TaskItem key={t.id} task={t} p={p} />)}</ul>
            : <p className="empty">Nada pendente. 🎉</p>}
        </div>
      </section>

      {done.length > 0 && (
        <section aria-labelledby="h-done">
          <h2 id="h-done">Feitas recentemente</h2>
          <div className="card"><ul className="list">{done.slice(0, 10).map((t) => <TaskItem key={t.id} task={t} p={p} />)}</ul></div>
        </section>
      )}
    </>
  );
}

// ---------- Remédios ----------

function MedForm({ med, p, onDone }: { med?: Medication; p: ScreenProps; onDone: () => void }) {
  const [name, setName] = useState(med?.name ?? "");
  const [dose, setDose] = useState(med?.dose ?? "");
  const [times, setTimes] = useState(med?.times.map(hhmm).join(", ") ?? "");
  const [instructions, setInstructions] = useState(med?.instructions ?? "");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseTimes(times);
    if ("error" in parsed) { setErr(parsed.error); return; }
    setErr(null);
    const ok = await p.act(() => p.store.saveMedication(p.snap.circle.id, {
      id: med?.id, name: name.trim(), dose: dose.trim(), times: parsed.times, instructions: instructions.trim() || null,
    }), med ? "Remédio atualizado." : "Remédio cadastrado.");
    if (ok) onDone();
  }

  return (
    <form className="stack" style={{ padding: 16 }} onSubmit={submit} aria-label={med ? `Editar ${med.name}` : "Novo remédio"}>
      <label className="field">Nome <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
      <label className="field">Dose <input value={dose} onChange={(e) => setDose(e.target.value)} required maxLength={60} placeholder="Ex.: 50 mg, 1 comprimido" /></label>
      <label className="field">Horários <small>separados por vírgula, ex.: 08:00, 20:00</small>
        <input value={times} onChange={(e) => setTimes(e.target.value)} required inputMode="numeric" aria-invalid={!!err} aria-describedby={err ? "times-err" : undefined} />
      </label>
      {err && <p id="times-err" className="error" role="alert">{err}</p>}
      <label className="field">Observação <small>opcional</small>
        <input value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={200} placeholder="Ex.: junto com a refeição" />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={!p.canWrite}>{med ? "Salvar" : "Cadastrar"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

export function Meds(p: ScreenProps) {
  const active = p.snap.medications.filter((m) => m.active);
  const [editing, setEditing] = useState<string | null>(null);   // med id, "new", or null
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section aria-labelledby="h-meds">
      <h2 id="h-meds">Remédios em uso <span className="count">{active.length}</span></h2>
      <div className="card">
        <ul className="list">
          {active.map((m) => (
            <li key={m.id}>
              {editing === m.id ? <MedForm med={m} p={p} onDone={() => setEditing(null)} /> : (
                <div className="shift-row">
                  <span className="who">
                    <b>{m.name}</b>
                    <span className="muted small">{m.dose} · {m.times.map(hhmm).join(", ")}{m.instructions ? ` · ${m.instructions}` : ""}</span>
                  </span>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn ghost" onClick={() => setEditing(m.id)} aria-label={`Editar ${m.name}`}>Editar</button>
                    {confirming === m.id ? (
                      <button className="btn secondary" onClick={() => { setConfirming(null); void p.act(() => p.store.archiveMedication(m.id), `${m.name} removido da rotina.`); }}>
                        Confirmar
                      </button>
                    ) : (
                      <button className="btn ghost" onClick={() => setConfirming(m.id)} aria-label={`Parar de dar ${m.name}`}>Parar</button>
                    )}
                  </span>
                </div>
              )}
            </li>
          ))}
          {!active.length && <li className="empty">Nenhum remédio cadastrado.</li>}
        </ul>
        {editing === "new" ? <MedForm p={p} onDone={() => setEditing(null)} /> : (
          <div style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
            <button className="btn block secondary" onClick={() => setEditing("new")} disabled={!p.canWrite}>+ Cadastrar remédio</button>
          </div>
        )}
      </div>
      <p className="small muted">Parar um remédio tira ele da rotina de hoje em diante; o histórico de doses fica guardado.</p>
    </section>
  );
}

// ---------- Família ----------

export function Family(p: ScreenProps & { onSignOut: () => void; onResetDemo?: () => void }) {
  const { snap, store, act, canWrite } = p;
  const me = snap.members.find((m) => m.user_id === snap.me);
  const isAdmin = me?.role === "admin";
  const [copied, setCopied] = useState(false);
  const shareText = `Entre na nossa rede de cuidado da ${snap.circle.care_recipient}: abra o app e use o código ${snap.circle.invite_code}`;

  async function copy() {
    try { await navigator.clipboard.writeText(snap.circle.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard blocked */ }
  }

  return (
    <>
      <section aria-labelledby="h-people">
        <h2 id="h-people">Quem cuida <span className="count">{snap.members.length} {snap.members.length === 1 ? "pessoa" : "pessoas"}</span></h2>
        <div className="card">
          <ul className="list">
            {snap.members.map((m) => (
              <li key={m.user_id} className="shift-row">
                <b>{m.display_name}{m.user_id === snap.me ? " (você)" : ""}</b>
                <span className="pill neutral">{m.role === "admin" ? "Organiza" : "Ajuda"}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="h-invite">
        <h2 id="h-invite">Chamar mais alguém</h2>
        <div className="card" style={{ padding: 16 }}>
          <p style={{ marginTop: 0 }}>Quem tiver este código entra na família e vê tudo o que está aqui.</p>
          <p className="code" aria-label={`Código de convite: ${snap.circle.invite_code.split("").join(" ")}`}>{snap.circle.invite_code}</p>
          <div style={{ display: "grid", gap: 8 }}>
            <a className="btn block" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
            <button className="btn block secondary" onClick={copy}>{copied ? "Copiado ✓" : "Copiar código"}</button>
            {isAdmin && (
              <button className="btn ghost" disabled={!canWrite}
                onClick={() => act(async () => { await store.regenerateInvite(snap.circle.id); }, "Código trocado. O anterior não funciona mais.")}>
                Trocar o código
              </button>
            )}
          </div>
        </div>
      </section>

      <section>
        <div style={{ display: "grid", gap: 8 }}>
          {p.onResetDemo && <button className="btn secondary block" onClick={p.onResetDemo}>Recomeçar a demonstração</button>}
          <button className="btn ghost block" onClick={p.onSignOut}>{store.mode === "demo" ? "Sair da demonstração" : "Sair da conta"}</button>
        </div>
      </section>
    </>
  );
}
