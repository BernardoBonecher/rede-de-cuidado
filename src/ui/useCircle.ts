import { useCallback, useEffect, useRef, useState } from "react";
import { DoseTakenError, ShiftTakenError, localDay, nameOf, timeOf, type Snapshot } from "../domain";
import type { Store } from "../data/store";

export interface Toast { message: string; undo?: () => Promise<void> }

/** Run a change, then tell the person what happened in plain words. */
export type Act = (change: () => Promise<void>, done?: string, undo?: () => Promise<void>) => Promise<boolean>;

function minutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Loads one circle, keeps it fresh (realtime + a clock tick) and wraps every change. */
export function useCircle(store: Store, circleId: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [today, setToday] = useState(localDay());
  const [nowMin, setNowMin] = useState(minutesNow());
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  const refresh = useCallback(async () => {
    try {
      const day = localDay();
      setToday(day);
      setSnap(await store.load(circleId, day));
      setError(null);
    } catch {
      setError("Não foi possível carregar os dados. Verifique a conexão e tente de novo.");
    }
  }, [store, circleId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => store.subscribe(circleId, () => void refresh()), [store, circleId, refresh]);

  // Statuses like "late" depend on the time of day: re-evaluate every minute, reload at midnight.
  useEffect(() => {
    const t = setInterval(() => {
      setNowMin(minutesNow());
      if (localDay() !== today) void refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [today, refresh]);

  useEffect(() => {
    const on = () => { setOnline(true); void refresh(); };
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const act: Act = useCallback(async (change, done, undo) => {
    if (!online && store.mode === "live") {
      setToast({ message: "Sem internet. A alteração não foi salva." });
      return false;
    }
    try {
      await change();
      if (done) setToast({ message: done, undo });
      await refresh();
      return true;
    } catch (err) {
      const s = snapRef.current;
      if (err instanceof DoseTakenError) {
        const who = s ? nameOf(s.members, err.log.given_by, s.me) : "Outra pessoa";
        setToast({ message: `${capitalize(who)} já marcou essa dose às ${timeOf(err.log.given_at)}. Não dê de novo.` });
      } else if (err instanceof ShiftTakenError) {
        const who = s ? nameOf(s.members, err.shift.user_id, s.me) : "Outra pessoa";
        setToast({ message: `${capitalize(who)} pegou esse turno antes de você.` });
      } else {
        setToast({ message: "Não foi possível salvar. Verifique a conexão e tente de novo." });
      }
      await refresh();
      return false;
    }
  }, [online, store, refresh]);

  return { snap, error, toast, setToast, today, nowMin, online, refresh, act };
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
