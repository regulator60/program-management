import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  Info,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DepHealth } from "@/lib/dependencies";
import type { Severity } from "@/lib/insights";
import type { Rag } from "@/lib/model";
import type { IssueView } from "@/lib/store";
import { LEVEL_LABEL, LEVEL_SHORT, type Level } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- layout

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  className,
  actions,
  icon: Icon,
  subtitle,
  flush,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  subtitle?: ReactNode;
  /** No inner padding (for edge-to-edge tables). */
  flush?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel shadow-card", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                {Icon && <Icon className="h-4 w-4 text-muted" aria-hidden />}
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- tags & badges

const LEVEL_COLORS: Record<Level, string> = {
  outcome: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900",
  cpm: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900",
  ipm_intent: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  ipm: "bg-yellow-50 text-yellow-800 ring-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:ring-yellow-900",
  epic: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-900",
  story: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700",
  risk: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  decision: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
  action: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-900",
  other: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700",
};

export function LevelTag({ level }: { level: Level }) {
  return (
    <span
      title={LEVEL_LABEL[level]}
      className={cx(
        "inline-flex h-5 items-center rounded px-1.5 font-mono text-[10px] font-semibold tracking-wide ring-1 ring-inset",
        LEVEL_COLORS[level],
      )}
    >
      {LEVEL_SHORT[level]}
    </span>
  );
}

export function StatusPill({ issue }: { issue: Pick<IssueView, "status" | "statusCategory"> }) {
  const dot =
    issue.statusCategory === "done"
      ? "bg-good"
      : issue.statusCategory === "indeterminate"
        ? "bg-accent"
        : "bg-line-strong";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel px-2 py-0.5 text-xs font-medium text-ink-2">
      <span className={cx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {issue.status}
    </span>
  );
}

type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info";

const TONE: Record<Tone, { cls: string; icon: LucideIcon; iconCls: string }> = {
  good: { cls: "bg-good-soft text-good-ink", icon: CheckCircle2, iconCls: "text-good" },
  warning: { cls: "bg-warning-soft text-warning-ink", icon: AlertTriangle, iconCls: "text-warning" },
  serious: { cls: "bg-serious-soft text-serious-ink", icon: AlertTriangle, iconCls: "text-serious" },
  critical: { cls: "bg-critical-soft text-critical-ink", icon: AlertOctagon, iconCls: "text-critical" },
  info: { cls: "bg-accent-soft text-accent", icon: Info, iconCls: "text-accent" },
  neutral: { cls: "bg-panel-2 text-ink-2", icon: CircleHelp, iconCls: "text-muted" },
};

/** Status badge: icon + label, so meaning never rests on color alone. */
export function ToneBadge({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: LucideIcon }) {
  const t = TONE[tone];
  const Icon = icon ?? t.icon;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", t.cls)}>
      <Icon className={cx("h-3.5 w-3.5", t.iconCls)} aria-hidden />
      {children}
    </span>
  );
}

export const HEALTH_STYLE: Record<DepHealth, { label: string; tone: Tone; icon?: LucideIcon }> = {
  conflict: { label: "Date conflict", tone: "critical" },
  overdue: { label: "Overdue", tone: "serious", icon: Clock },
  tight: { label: "Tight", tone: "warning" },
  unknown: { label: "No date", tone: "neutral", icon: CircleDashed },
  ok: { label: "On track", tone: "good" },
  done: { label: "Done", tone: "good" },
};

export function HealthBadge({ health }: { health: DepHealth }) {
  const s = HEALTH_STYLE[health];
  return (
    <ToneBadge tone={s.tone} icon={s.icon}>
      {s.label}
    </ToneBadge>
  );
}

const RAG_TONE: Record<Rag, { tone: Tone; label: string }> = {
  green: { tone: "good", label: "On track" },
  amber: { tone: "warning", label: "At risk" },
  red: { tone: "critical", label: "Off track" },
};

export function RagBadge({ rag }: { rag: Rag }) {
  return <ToneBadge tone={RAG_TONE[rag].tone}>{RAG_TONE[rag].label}</ToneBadge>;
}

/** Compact RAG marker; `label` adds the word. Kept for older call sites. */
export function RagDot({ rag, label }: { rag: Rag; label?: boolean }) {
  if (label) return <RagBadge rag={rag} />;
  const Icon = TONE[RAG_TONE[rag].tone].icon;
  return (
    <span title={RAG_TONE[rag].label} className="inline-flex">
      <Icon className={cx("h-4 w-4", TONE[RAG_TONE[rag].tone].iconCls)} aria-hidden />
      <span className="sr-only">{RAG_TONE[rag].label}</span>
    </span>
  );
}

export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "critical",
  serious: "serious",
  warning: "warning",
  info: "info",
  good: "good",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  serious: "High",
  warning: "Watch",
  info: "FYI",
  good: "Done",
};

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const t = TONE[SEVERITY_TONE[severity]];
  const Icon = t.icon;
  return <Icon className={cx("h-4 w-4 shrink-0", t.iconCls, className)} aria-label={SEVERITY_LABEL[severity]} />;
}

export function KeyLink({ k, external }: { k: string; external?: boolean }) {
  return (
    <Link
      href={`/items/${encodeURIComponent(k)}`}
      className={cx(
        "whitespace-nowrap font-mono text-xs font-medium hover:underline",
        external ? "text-muted" : "text-accent",
      )}
    >
      {k}
    </Link>
  );
}

export function Pending({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      title="Local edit not yet pushed to Jira"
      className="ml-1.5 inline-flex items-center rounded bg-fuchsia-50 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:ring-fuchsia-900"
    >
      Pending
    </span>
  );
}

// ---------------------------------------------------------------- numbers & dates

export function fmtDate(d: string | null | undefined, withYear = true) {
  if (!d) return "—";
  const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function relDays(d: string | null | undefined, today: string) {
  if (!d) return "";
  const n = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function DateCell({ date, late, pending }: { date: string | null; late?: boolean; pending?: boolean }) {
  return (
    <span className={cx("tabular whitespace-nowrap text-sm", late ? "font-semibold text-critical-ink" : "text-ink-2")}>
      {late && <Clock className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-critical" aria-label="Past due" />}
      {fmtDate(date)}
      <Pending show={!!pending} />
    </span>
  );
}

/**
 * Progress bar: done (dark) + in progress (light) on a neutral track.
 * Ordinal one-hue ramp, validated light & dark. Hover shows the counts.
 */
export function Progress({
  done,
  total,
  active = 0,
  width = "w-24",
  showLabel = true,
}: {
  done: number;
  total: number;
  active?: number;
  width?: string;
  showLabel?: boolean;
}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pctActive = total ? Math.round((active / total) * 100) : 0;
  return (
    <div className="tip relative inline-flex items-center gap-2">
      <div className={cx("flex h-1.5 overflow-hidden rounded-full bg-progress-track", width)}>
        <div className="h-full bg-progress-done" style={{ width: `${pct}%` }} />
        {pctActive > 0 && <div className="ml-px h-full bg-progress-active" style={{ width: `${pctActive}%` }} />}
      </div>
      {showLabel && <span className="tabular w-9 text-xs font-medium text-ink-2">{total ? `${pct}%` : "—"}</span>}
      <span className="tip-body">
        {done} done{active ? ` · ${active} in progress` : ""} · {total - done - active} not started
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  icon: Icon,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: "red" | "amber" | "green";
  icon?: LucideIcon;
  hint?: ReactNode;
  href?: string;
}) {
  const accent =
    tone === "red" ? "text-critical" : tone === "amber" ? "text-warning" : tone === "green" ? "text-good" : "text-muted";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        {Icon && <Icon className={cx("h-4 w-4", accent)} aria-hidden />}
      </div>
      <div className="tabular mt-2 text-[28px] font-semibold leading-none tracking-tight text-fg">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = "block rounded-xl border border-line bg-panel p-4 shadow-card";
  return href ? (
    <Link href={href} className={cx(cls, "transition hover:border-line-strong hover:shadow-pop")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---------------------------------------------------------------- empty, buttons, inputs, tables

export function Empty({ children, icon: Icon = CircleDashed }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-panel px-6 py-12 text-center text-sm text-ink-2">
      <Icon className="h-6 w-6 text-muted" aria-hidden />
      <div className="max-w-md">{children}</div>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  const v =
    variant === "primary"
      ? "bg-accent text-white shadow-sm hover:brightness-110"
      : variant === "danger"
        ? "border border-line bg-panel text-critical-ink hover:bg-critical-soft"
        : variant === "ghost"
          ? "text-ink-2 hover:bg-panel-2"
          : "border border-line bg-panel text-fg shadow-sm hover:bg-panel-2";
  const s = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
        v,
        s,
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg shadow-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cx("sticky top-0 z-10 bg-panel-2 px-4 py-2.5 text-left text-xs font-semibold text-ink-2", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx("px-4 py-3 align-top text-sm", className)}>
      {children}
    </td>
  );
}
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-panel-2/60">
        {children}
      </table>
    </div>
  );
}
