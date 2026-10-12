import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DemoStore } from "./data/demo";
import { InvalidCodeError, type Store } from "./data/store";
import { dayLabel, doseSchedule } from "./domain";
import { IconCalendar, IconCheck, IconHeart, IconPeople, IconPill, IconToday } from "./ui/icons";
import { Agenda, Family, Meds, Tasks, Today, type ScreenProps } from "./ui/screens";
import { useCircle } from "./ui/useCircle";

type Mode = "demo" | "live";
const MODE_KEY = "rede-de-cuidado-mode";

function readMode(): Mode | null {
  // ?demo opens the demo directly (the link shared in the README and on LinkedIn)
  if (new URLSearchParams(location.search).has("demo")) { writeMode("demo"); return "demo"; }
  try { return (localStorage.getItem(MODE_KEY) as Mode | null) ?? null; } catch { return null; }
}
function writeMode(mode: Mode | null) {
  try { mode ? localStorage.setItem(MODE_KEY, mode) : localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
}

export default function App() {
  const [mode, setMode] = useState<Mode | null>(readMode);
  const [store, setStore] = useState<Store | null>(null);

  // The Supabase client is most of the bundle; demo visitors never download it.
  useEffect(() => {
    let cancelled = false;
    if (mode === "demo") setStore(new DemoStore());
    else if (mode === "live") void import("./data/live").then(({ LiveStore }) => { if (!cancelled) setStore(new LiveStore()); });
    else setStore(null);
    return () => { cancelled = true; };
  }, [mode]);

  const choose = (m: Mode | null) => { writeMode(m); setMode(m); };

  if (!mode) return <Welcome onDemo={() => choose("demo")} onLogin={() => choose("live")} />;
  if (!store || store.mode !== mode) return <main className="app"><div className="skeleton" /></main>;
  return <Session key={mode} store={store} onExit={() => choose(null)} />;
}

// ---------- entry ----------

function Entry({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <main className="entry">
      <div className="mark" aria-hidden="true"><IconHeart /></div>
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </main>
  );
}

function Welcome({ onDemo, onLogin }: { onDemo: () => void; onLogin: () => void }) {
  return (
    <Entry title="Rede de Cuidado"
      lede="Para a família que divide o cuidado de alguém: quem dá o remédio, quem fica em cada turno e o que falta fazer, no mesmo lugar.">
      <div className="choices">
        <button className="btn block" onClick={onDemo}>Ver a demonstração</button>
        <button className="btn block secondary" onClick={onLogin}>Entrar com uma conta</button>
      </div>
      <p className="note">
        A demonstração usa uma família fictícia e funciona só no seu navegador. Este é um projeto de portfólio:
        não use para dados reais de saúde, e ele não substitui orientação médica.
      </p>
    </Entry>
  );
}

function Login({ store, onDone, onBack }: { store: Store; onDone: () => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try { await store.signIn(email.trim(), password); onDone(); }
    catch (error) { setErr(error instanceof Error ? error.message : "Não foi possível entrar."); }
    finally { setBusy(false); }
  }

  return (
    <Entry title="Entrar" lede="Contas são criadas por convite. Para conhecer o app sem conta, use a demonstração.">
      <form className="stack" onSubmit={submit}>
        <label className="field">E-mail <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Senha <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        <button type="button" className="link" onClick={onBack}>Voltar</button>
      </form>
    </Entry>
  );
}

function Onboarding({ store, onDone, onExit }: { store: Store; onDone: (circleId: string) => void; onExit: () => void }) {
  const [tab, setTab] = useState<"create" | "join">("join");
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onDone(tab === "join"
        ? await store.joinCircle(code, name)
        : await store.createCircle(`Cuidado de ${recipient.trim()}`, recipient, name));
    } catch (error) {
      setErr(error instanceof InvalidCodeError ? "Esse código não existe. Confira com quem te convidou." : "Não foi possível continuar. Tente de novo.");
    } finally { setBusy(false); }
  }

  return (
    <Entry title="Sua família" lede="Entre com o código que alguém da família te mandou, ou comece uma nova.">
      <div className="choices" role="tablist" style={{ gridTemplateColumns: "1fr 1fr", display: "grid" }}>
        <button role="tab" aria-selected={tab === "join"} className={`btn ${tab === "join" ? "" : "secondary"}`} onClick={() => setTab("join")}>Tenho um código</button>
        <button role="tab" aria-selected={tab === "create"} className={`btn ${tab === "create" ? "" : "secondary"}`} onClick={() => setTab("create")}>Começar uma</button>
      </div>
      <form className="stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <label className="field">Seu nome <small>como a família te chama</small>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        {tab === "join" ? (
          <label className="field">Código de convite
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required maxLength={8} autoCapitalize="characters" style={{ letterSpacing: "0.15em" }} />
          </label>
        ) : (
          <label className="field">De quem vocês cuidam <small>ex.: Dona Lúcia</small>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} required maxLength={60} />
          </label>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn block" disabled={busy}>{tab === "join" ? "Entrar na família" : "Criar"}</button>
        <button type="button" className="link" onClick={onExit}>Sair</button>
      </form>
    </Entry>
  );
}

// ---------- signed-in session ----------

function Session({ store, onExit }: { store: Store; onExit: () => void }) {
  const [phase, setPhase] = useState<"checking" | "login" | "onboarding" | "ready">("checking");
  const [circleId, setCircleId] = useState<string | null>(null);

  const check = async () => {
    setPhase("checking");
    try {
      if (!(await store.currentUser())) { setPhase("login"); return; }
      const cid = await store.myCircleId();
      setCircleId(cid);
      setPhase(cid ? "ready" : "onboarding");
    } catch { setPhase("login"); }
  };
  useEffect(() => { void check(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  const exit = async () => { await store.signOut(); onExit(); };

  if (phase === "checking") return <main className="app"><div className="skeleton" /><div className="skeleton" /></main>;
  if (phase === "login") return <Login store={store} onDone={check} onBack={onExit} />;
  if (phase === "onboarding" || !circleId) return <Onboarding store={store} onDone={(id) => { setCircleId(id); setPhase("ready"); }} onExit={exit} />;
  return <Shell store={store} circleId={circleId} onExit={exit} />;
}

const TABS = [
  { id: "hoje", label: "Hoje", Icon: IconToday },
  { id: "agenda", label: "Agenda", Icon: IconCalendar },
  { id: "tarefas", label: "Tarefas", Icon: IconCheck },
  { id: "remedios", label: "Remédios", Icon: IconPill },
  { id: "familia", label: "Família", Icon: IconPeople },
] as const;
type TabId = (typeof TABS)[number]["id"];

function useHashTab(): TabId {
  const read = () => (TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "hoje") as TabId;
  const [tab, setTab] = useState<TabId>(read);
  useEffect(() => {
    const on = () => { setTab(read()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return tab;
}

function Shell({ store, circleId, onExit }: { store: Store; circleId: string; onExit: () => void }) {
  const tab = useHashTab();
  const { snap, error, toast, setToast, today, nowMin, online, refresh, act } = useCircle(store, circleId);

  if (!snap) {
    return (
      <main className="app">
        {error ? (
          <div className="entry"><p className="error" role="alert">{error}</p><button className="btn" onClick={() => void refresh()}>Tentar de novo</button></div>
        ) : <><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></>}
      </main>
    );
  }

  const canWrite = online || store.mode === "demo";
  const p: ScreenProps = { store, snap, today, nowMin, act, canWrite };
  const late = doseSchedule(snap.medications, snap.doses, nowMin).filter((r) => r.status === "late").length;
  const title = TABS.find((t) => t.id === tab)!.label;

  return (
    <>
      <main className="app">
        <header className="top">
          <div>
            <h1>{tab === "hoje" ? snap.circle.care_recipient : title}</h1>
            <p className="sub">{tab === "hoje" ? `${dayLabel(today, today)}, ${new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}` : snap.circle.care_recipient}</p>
          </div>
        </header>
        {store.mode === "demo" && (
          <p className="demo-banner">
            <span>Demonstração com uma família fictícia. Você é a Ana.</span>
          </p>
        )}
        {!canWrite && <p className="offline" role="status">Sem internet. Você vê os dados da última atualização; alterações ficam bloqueadas.</p>}
        {error && snap && <p className="offline" role="status">{error}</p>}

        {tab === "hoje" && <Today {...p} />}
        {tab === "agenda" && <Agenda {...p} />}
        {tab === "tarefas" && <Tasks {...p} />}
        {tab === "remedios" && <Meds {...p} />}
        {tab === "familia" && (
          <Family {...p} onSignOut={onExit}
            onResetDemo={store instanceof DemoStore ? () => { store.reset(); setToast({ message: "Demonstração reiniciada." }); } : undefined} />
        )}
      </main>

      <div aria-live="polite" role="status">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            {toast.undo && <button className="link" onClick={() => { const u = toast.undo!; setToast(null); void act(u, "Desfeito."); }}>Desfazer</button>}
          </div>
        )}
      </div>

      <nav className="tabs" aria-label="Seções">
        <ul>
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <a href={`#${id}`} aria-current={tab === id ? "page" : undefined}>
                <Icon />
                <span>{label}{id === "hoje" && late > 0 && <> <span className="badge" aria-label={`${late} atrasadas`}>{late}</span></>}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
