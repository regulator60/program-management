import type { Dependency } from "@/lib/dependencies";
import type { IssueView } from "@/lib/store";
import { LEVEL_SHORT, type Level } from "@/lib/types";
import { withBase } from "@/lib/paths";

export type GanttRow = {
  issue: IssueView;
  depth: number;
  section?: string; // header row label instead of an issue
};

const ROW_H = 30;
const LABEL_W = 380;
const HEADER_H = 44;

/**
 * Restrained palette: work bars in one blue, milestones in ink/accent, other
 * tracks in slate. Status colors are reserved for state (done, late, conflict).
 */
const FILL: Record<Level, string> = {
  outcome: "#94a3b8",
  cpm: "#0f172a",
  ipm_intent: "#1c5cab",
  ipm: "#64748b",
  epic: "#2a78d6",
  story: "#86b6ef",
  risk: "#d03b3b",
  decision: "#64748b",
  action: "#64748b",
  other: "#94a3b8",
};
const DONE = "#0ca30c";
const LATE = "#d03b3b";
const EXTERNAL = "#94a3b8";

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

export function Gantt({
  rows,
  deps,
  today,
  dayWidth,
  showDeps,
}: {
  rows: GanttRow[];
  deps: Dependency[];
  today: string;
  dayWidth: number;
  showDeps: boolean;
}) {
  const dates = rows.flatMap((r) => [r.issue?.startDate, r.issue?.dueDate]).filter((d): d is string => !!d);
  dates.push(today);
  const min = Math.min(...dates.map(toDay)) - 14;
  const max = Math.max(...dates.map(toDay)) + 21;
  const width = LABEL_W + (max - min) * dayWidth;
  const height = HEADER_H + rows.length * ROW_H + 10;
  const x = (iso: string) => LABEL_W + (toDay(iso) - min) * dayWidth;

  // Month ticks
  const ticks: { x: number; label: string; major: boolean }[] = [];
  const start = new Date(fromDay(min) + "T00:00:00Z");
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (toDay(cur.toISOString().slice(0, 10)) <= max) {
    const iso = cur.toISOString().slice(0, 10);
    if (toDay(iso) >= min) {
      ticks.push({
        x: x(iso),
        label: cur.toLocaleDateString("en-US", { month: "short", year: cur.getUTCMonth() === 0 ? "numeric" : undefined, timeZone: "UTC" }),
        major: cur.getUTCMonth() % 3 === 0,
      });
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.issue && !r.section && rowIndex.set(r.issue.key, i));
  const y = (i: number) => HEADER_H + i * ROW_H;

  const barGeom = (i: IssueView) => {
    const s = i.startDate ?? i.dueDate;
    const e = i.dueDate ?? i.startDate;
    if (!s || !e) return null;
    return { x1: x(s), x2: Math.max(x(e) + dayWidth, x(s) + 3) };
  };

  const isMilestone = (l: Level) => l === "cpm" || l === "ipm" || l === "ipm_intent";

  const arrows = showDeps
    ? deps.flatMap((d) => {
        const pi = rowIndex.get(d.predecessor.key);
        const si = rowIndex.get(d.successor.key);
        if (pi === undefined || si === undefined) return [];
        const pg = barGeom(d.predecessor);
        const sg = barGeom(d.successor);
        if (!pg || !sg) return [];
        const x1 = pg.x2;
        const y1 = y(pi) + ROW_H / 2;
        // Milestones are points: aim at the diamond, not the start of the span.
        const x2 = isMilestone(d.successor.level) && d.successor.dueDate ? x(d.successor.dueDate) - 6 : sg.x1;
        const y2 = y(si) + ROW_H / 2;
        const color = d.health === "conflict" ? "#d03b3b" : d.health === "overdue" ? "#ec835a" : d.health === "tight" ? "#c98500" : "#94a3b8";
        const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
        return [{ key: `${d.predecessor.key}-${d.successor.key}`, path: `M${x1},${y1} H${mid} V${y2} H${x2 - 2}`, color, title: d.reason }];
      })
    : [];

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel shadow-card">
      <svg width={width} height={height} className="block text-[11px]" role="img" aria-label="Gantt chart">
        <defs>
          {["#d03b3b", "#ec835a", "#c98500", "#94a3b8"].map((c) => (
            <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={c} />
            </marker>
          ))}
        </defs>

        {/* zebra + grid */}
        {rows.map((r, i) => (
          <rect key={`bg${i}`} x={0} y={y(i)} width={width} height={ROW_H} fill={r.section ? "var(--panel-2)" : i % 2 ? "transparent" : "rgba(127,127,127,0.035)"} />
        ))}
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} x2={t.x} y1={HEADER_H - 14} y2={height} stroke="var(--line)" strokeWidth={t.major ? 1.5 : 1} />
            <text x={t.x + 4} y={HEADER_H - 18} fill="var(--muted)">{t.label}</text>
          </g>
        ))}
        <line x1={LABEL_W} x2={LABEL_W} y1={0} y2={height} stroke="var(--line)" />

        {/* today */}
        <line x1={x(today)} x2={x(today)} y1={HEADER_H - 10} y2={height} stroke="var(--accent)" strokeWidth={1.5} />
        <rect x={x(today) - 20} y={HEADER_H - 16} width={40} height={14} rx={3} fill="var(--accent)" />
        <text x={x(today)} y={HEADER_H - 5.5} fill="#fff" fontWeight={600} fontSize={10} textAnchor="middle">Today</text>

        {rows.map((r, i) => {
          if (r.section) {
            return (
              <text key={`s${i}`} x={12} y={y(i) + 19} fontWeight={600} fontSize={11} fill="var(--ink-2)" letterSpacing="0.04em">
                {r.section}
              </text>
            );
          }
          const it = r.issue;
          const g = barGeom(it);
          const late = !!it.dueDate && it.dueDate < today && it.statusCategory !== "done";
          const label = it.summary.length > 40 - r.depth * 2 ? it.summary.slice(0, 38 - r.depth * 2) + "…" : it.summary;
          const color = it.inScope ? FILL[it.level] : EXTERNAL;
          const cy = y(i) + ROW_H / 2;
          const tip = `${it.key} · ${it.summary}\n${it.startDate ?? "?"} → ${it.dueDate ?? "?"} · ${it.status}${it.pendingFields.length ? "\n(pending local edits)" : ""}`;
          return (
            <g key={it.key}>
              <a href={withBase(`/items/${encodeURIComponent(it.key)}`)}>
                <title>{tip}</title>
                <text x={12 + r.depth * 14} y={cy + 4} fontSize={12} fill={it.inScope ? "var(--foreground)" : "var(--muted)"} fontWeight={it.level === "outcome" || it.level === "cpm" ? 600 : 400}>
                  <tspan fontFamily="var(--font-geist-mono)" fontSize={9} fill="var(--muted)" fontWeight={600}>
                    {LEVEL_SHORT[it.level]}{" "}
                  </tspan>
                  <tspan fontFamily="var(--font-geist-mono)" fontSize={10}>{it.key} </tspan>
                  <tspan>{label}</tspan>
                </text>
              </a>
              {g && (
                <g>
                  <title>{tip}</title>
                  {isMilestone(it.level) || it.level === "outcome" ? (
                    <>
                      {it.startDate && it.dueDate && (
                        <rect x={g.x1} y={cy - 2} width={Math.max(g.x2 - g.x1, 2)} height={4} rx={2} fill={color} opacity={0.35} />
                      )}
                      {it.dueDate && (
                        <path
                          d={`M${x(it.dueDate) + dayWidth / 2},${cy - 7} l7,7 l-7,7 l-7,-7 z`}
                          fill={it.statusCategory === "done" ? DONE : late ? LATE : color}
                          stroke="var(--panel)"
                          strokeWidth={2}
                        />
                      )}
                    </>
                  ) : (
                    <rect
                      x={g.x1}
                      y={cy - 7}
                      width={Math.max(g.x2 - g.x1, 3)}
                      height={14}
                      rx={3}
                      fill={it.statusCategory === "done" ? DONE : color}
                      opacity={it.inScope ? 0.9 : 0.5}
                      stroke={late ? LATE : it.pendingFields.length ? "#c026d3" : "none"}
                      strokeWidth={2}
                      strokeDasharray={it.pendingFields.length ? "3 2" : undefined}
                    />
                  )}
                </g>
              )}
              {!g && (
                <text x={LABEL_W + 6} y={cy + 4} fill="var(--muted)" fontStyle="italic">no dates</text>
              )}
            </g>
          );
        })}

        {arrows.map((a) => (
          <path key={a.key} d={a.path} fill="none" stroke={a.color} strokeWidth={1.5} markerEnd={`url(#arrow-${a.color.slice(1)})`} opacity={0.85}>
            <title>{a.title}</title>
          </path>
        ))}
      </svg>
    </div>
  );
}
