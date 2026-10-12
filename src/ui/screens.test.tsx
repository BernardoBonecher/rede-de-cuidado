// Screen behavior with the demo store: what a family member actually does and sees.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DemoStore } from "../data/demo";
import { DoseTakenError, localDay, minutesOf, type Snapshot } from "../domain";
import { Today, type ScreenProps } from "./screens";
import { useCircle } from "./useCircle";

const today = localDay();

function Harness({ store, nowMin }: { store: DemoStore; nowMin: number }) {
  const { snap, act, toast } = useCircle(store, "c");
  const [, force] = useState(0);
  if (!snap) return <p>carregando</p>;
  const p: ScreenProps = { store, snap: snap as Snapshot, today, nowMin, act: async (...a) => { const r = await act(...a); force((n) => n + 1); return r; }, canWrite: true };
  return <><Today {...p} /><p data-testid="toast">{toast?.message}</p></>;
}

test("marking a dose shows who gave it, and the toast confirms", async () => {
  const store = new DemoStore(false, today);
  render(<Harness store={store} nowMin={minutesOf("12:10")} />);

  const button = await screen.findByRole("button", { name: "Marcar Vitamina D das 12:00 como dado" });
  await userEvent.click(button);

  await waitFor(() => expect(screen.getByTestId("toast")).toHaveTextContent("Vitamina D das 12:00 marcado como dado."));
  expect(screen.queryByRole("button", { name: "Marcar Vitamina D das 12:00 como dado" })).not.toBeInTheDocument();
  expect(screen.getAllByText(/Por você às/).length).toBeGreaterThan(0);
});

test("if a relative already gave the dose, the screen says who and when instead of doubling it", async () => {
  const store = new DemoStore(false, today);
  render(<Harness store={store} nowMin={minutesOf("12:10")} />);
  const button = await screen.findByRole("button", { name: "Marcar Vitamina D das 12:00 como dado" });

  // The stale-screen case: Bruno marked it on his phone and the realtime update hasn't arrived
  // yet, so the server answers with a conflict. (With realtime working, the button would already
  // be gone; the store's own rule is covered in demo.test.ts and against Postgres in rls.test.mjs.)
  vi.spyOn(store, "giveDose").mockRejectedValueOnce(new DoseTakenError({
    id: "x", medication_id: "med-vitd", day: today, slot: "12:00", given_at: new Date().toISOString(), given_by: "demo-bruno",
  }));
  await userEvent.click(button);

  await waitFor(() => expect(screen.getByTestId("toast")).toHaveTextContent(/^Bruno já marcou essa dose às \d\d:\d\d\. Não dê de novo\.$/));
});

test("another relative's change appears without reloading", async () => {
  const store = new DemoStore(false, today);
  render(<Harness store={store} nowMin={minutesOf("12:10")} />);
  await screen.findByRole("button", { name: "Marcar Vitamina D das 12:00 como dado" });
  await store.giveDose("c", "med-vitd", today, "12:00", "demo-bruno");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Marcar Vitamina D das 12:00 como dado" })).not.toBeInTheDocument());
  expect(screen.getAllByText(/Por Bruno às/).length).toBeGreaterThan(0);
});

test("late doses are labeled in text, not only by color", async () => {
  const store = new DemoStore(false, today);
  render(<Harness store={store} nowMin={minutesOf("23:00")} />);
  expect((await screen.findAllByText("Atrasado")).length).toBeGreaterThan(0);
});
