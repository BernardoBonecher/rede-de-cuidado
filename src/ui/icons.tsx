// Simple line icons (24px grid). Decorative: every icon sits next to a visible text label.
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconToday = () => (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconCalendar = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
);
export const IconCheck = () => (
  <svg {...base}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>
);
export const IconPill = () => (
  <svg {...base}><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="M8.5 8.5l7 7" /></svg>
);
export const IconPeople = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>
);
export const IconHeart = () => (
  <svg {...base} width={30} height={30}><path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 4 4 7.2 4c1.9 0 3.5 1 4.8 2.7C13.3 5 14.9 4 16.8 4 20 4 22.4 7.2 21.2 10.6 19.5 15.4 12 20 12 20z" /></svg>
);
export const Dot = ({ kind }: { kind: "ok" | "late" | "gap" | "due" | "neutral" }) => (
  <span aria-hidden="true">{{ ok: "✓", late: "!", gap: "○", due: "●", neutral: "·" }[kind]}</span>
);
