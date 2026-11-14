import Link from "next/link";
import { cx, fmtDate } from "@/components/ui";
import type { IssueView } from "@/lib/store";

export type RoadmapLane = { name: string; milestones: IssueView[] };
export type MilestoneState = "done" | "late" | "risk" | "ontrack";

const STATE: Record<MilestoneState, { label: string; fill: string; ring: string }> = {
  done: { label: "Done", fill: "bg-good", ring: "ring-good/30" },
  late: { label: "Past due", fill: "bg-critical", ring: "ring-critical/30" },
  risk: { label: "At risk", fill: "bg-warning", ring: "ring-warning/40" },
  ontrack: { label: "On track", fill: "bg-accent", ring: "ring-accent/25" },
};

const DAY = 86_400_000;

/**
 * Milestone roadmap: one lane per sub-track, milestones placed on a shared
 * time axis. Shape = level (large diamond = critical path, small diamond =
 * intent, dot = interim); color + legend = state. Hover any marker for details.
 */
export function Roadmap({
  lanes,
  today,
  stateOf,
  days = 120,
}: {
  lanes: RoadmapLane[];
  today: string;
  stateOf: (i: IssueView) => MilestoneState;
  days?: number;
}) {
  const start = Date.parse(today) - 14 * DAY;
  const end = Date.parse(today) + days * DAY;
  const pos = (iso: string) => ((Date.parse(iso) - start) / (end - start)) * 100;
  const inWindow = (i: IssueView) => !!i.dueDate && Date.parse(i.dueDate) >= start && Date.parse(i.dueDate) <= end;

  const months: { left: number; label: string }[] = [];
  const d = new Date(start);
  const cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  while (cur.getTime() <= end) {
    months.push({
      left: pos(cur.toISOString().slice(0, 10)),
      label: cur.toLocaleDateString("en-US", { month: "short", year: cur.getUTCMonth() === 0 ? "numeric" : undefined, timeZone: "UTC" }),
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  const visibleLanes = lanes.map((l) => ({ ...l, milestones: l.milestones.filter(inWindow) })).filter((l) => l.milestones.length);
  const outside = lanes.reduce((n, l) => n + l.milestones.filter((m) => !inWindow(m)).length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {(Object.keys(STATE) as MilestoneState[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cx("h-2.5 w-2.5 rotate-45 rounded-[2px]", STATE[k].fill)} aria-hidden />
            {STATE[k].label}
          </span>
        ))}
        <span className="ml-auto text-muted">
          Large diamond = critical path · small diamond = intent · dot = interim
          {outside > 0 && ` · ${outside} outside this window`}
        </span>
      </div>
      <div className="relative">
        {/* month grid + labels */}
        <div className="relative ml-36 h-6 border-b border-line text-[11px] text-muted">
          {months.map((m) => (
            <span key={m.label + m.left} className="absolute -translate-x-1/2" style={{ left: `${m.left}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        {visibleLanes.length === 0 && <p className="py-8 text-center text-sm text-muted">No milestones in the next {days} days.</p>}
        {visibleLanes.map((lane) => (
          <div key={lane.name} className="flex items-center border-b border-line last:border-b-0">
            <div className="w-36 shrink-0 truncate py-4 pr-3 text-sm font-medium text-fg" title={lane.name}>
              {lane.name}
            </div>
            <div className="relative h-14 flex-1">
              {months.map((m) => (
                <div key={m.left} className="absolute inset-y-0 w-px bg-line" style={{ left: `${m.left}%` }} aria-hidden />
              ))}
              {lane.milestones.map((i) => {
                const st = stateOf(i);
                const size = i.level === "cpm" ? "h-3.5 w-3.5" : i.level === "ipm_intent" ? "h-2.5 w-2.5" : "h-2 w-2 rounded-full";
                return (
                  <Link
                    key={i.key}
                    href={`/items/${encodeURIComponent(i.key)}`}
                    className="tip absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5"
                    style={{ left: `${pos(i.dueDate!)}%` }}
                    aria-label={`${i.key} ${i.summary}, due ${fmtDate(i.dueDate)}, ${STATE[st].label}`}
                  >
                    <span
                      className={cx(
                        "block ring-4",
                        size,
                        i.level !== "ipm" && "rotate-45 rounded-[2px]",
                        STATE[st].fill,
                        STATE[st].ring,
                      )}
                    />
                    {i.level === "cpm" && (
                      <span className="absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-medium text-ink-2">
                        {i.key}
                      </span>
                    )}
                    <span className="tip-body">
                      <b>{i.key}</b> · {fmtDate(i.dueDate)} · {STATE[st].label}
                      <br />
                      {i.summary}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {/* today line across lanes */}
        {visibleLanes.length > 0 && (
          <div className="pointer-events-none absolute inset-y-0 left-36 right-0" aria-hidden>
            <div className="absolute inset-y-0 w-px bg-accent" style={{ left: `${pos(today)}%` }}>
              <span className="absolute -top-0.5 left-1 rounded bg-accent px-1 text-[10px] font-semibold text-white">Today</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
