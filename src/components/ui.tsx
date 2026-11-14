import Link from "next/link";
import type { ReactNode } from "react";
import type { DepHealth } from "@/lib/dependencies";
import type { Rag } from "@/lib/model";
import type { IssueView } from "@/lib/store";
import { LEVEL_LABEL, LEVEL_SHORT, type Level } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const LEVEL_COLORS: Record<Level, string> = {
  outcome: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  cpm: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  ipm_intent: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  ipm: "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
  epic: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  story: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  risk: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  decision: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  action: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function LevelTag({ level }: { level: Level }) {
  return (
    <span
      title={LEVEL_LABEL[level]}
      className={cx("inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", LEVEL_COLORS[level])}
    >
      {LEVEL_SHORT[level]}
    </span>
  );
}

export function StatusPill({ issue }: { issue: Pick<IssueView, "status" | "statusCategory"> }) {
  const c =
    issue.statusCategory === "done"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : issue.statusCategory === "indeterminate"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={cx("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs", c)}>{issue.status}</span>;
}

export const HEALTH_STYLE: Record<DepHealth, { label: string; cls: string }> = {
  conflict: { label: "Date conflict", cls: "bg-red-600 text-white" },
  overdue: { label: "Overdue", cls: "bg-orange-500 text-white" },
  tight: { label: "Tight", cls: "bg-amber-300 text-amber-950" },
  unknown: { label: "No date", cls: "bg-zinc-300 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-50" },
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  done: { label: "Done", cls: "bg-emerald-600 text-white" },
};

export function HealthBadge({ health }: { health: DepHealth }) {
  const s = HEALTH_STYLE[health];
  return <span className={cx("inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium", s.cls)}>{s.label}</span>;
}

export function RagDot({ rag, label }: { rag: Rag; label?: boolean }) {
  const c = rag === "red" ? "bg-red-600" : rag === "amber" ? "bg-amber-400" : "bg-emerald-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("inline-block h-3 w-3 rounded-full", c)} aria-hidden />
      {label && <span className="text-xs font-medium uppercase">{rag}</span>}
      {!label && <span className="sr-only">{rag}</span>}
    </span>
  );
}

export function KeyLink({ k, external }: { k: string; external?: boolean }) {
  return (
    <Link
      href={`/items/${encodeURIComponent(k)}`}
      className={cx("whitespace-nowrap font-mono text-xs hover:underline", external ? "text-muted" : "text-accent")}
    >
      {k}
    </Link>
  );
}

export function Pending({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span title="Local edit not yet pushed to Jira" className="ml-1 rounded bg-fuchsia-100 px-1 text-[10px] font-semibold text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200">
      PENDING
    </span>
  );
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
}

export function DateCell({ date, late, pending }: { date: string | null; late?: boolean; pending?: boolean }) {
  return (
    <span className={cx("whitespace-nowrap tabular-nums", late && "font-semibold text-red-600 dark:text-red-400")}>
      {fmtDate(date)}
      <Pending show={!!pending} />
    </span>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${done}/${total} done`}>
      <div className="h-1.5 w-20 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{total ? `${pct}%` : "—"}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}

export function Button({ children, variant = "primary", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-accent text-white hover:opacity-90"
      : variant === "danger"
        ? "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        : "border border-line hover:bg-zinc-100 dark:hover:bg-zinc-800";
  return (
    <button {...rest} className={cx("rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50", v, rest.className)}>
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-md border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-2 py-1.5 align-top", className)}>{children}</td>;
}
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line">{children}</table>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" }) {
  const t = tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "green" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", t)}>{value}</div>
    </div>
  );
}
