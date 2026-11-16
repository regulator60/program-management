"use client";

import { ArrowRight, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crosshair, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { LEVEL_LABEL, LEVEL_SHORT, type Level, type StatusCategory } from "@/lib/types";

/* ------------------------------------------------------------------ types */

export type GanttItem = {
  key: string;
  summary: string;
  level: Level;
  depth: number;
  /** Nearest visible ancestor in the plan hierarchy. */
  parentKey: string | null;
  start: string | null;
  due: string | null;
  status: string;
  statusCategory: StatusCategory;
  assignee: string | null;
  team: string | null;
  inScope: boolean;
  pending: boolean;
  /** Descendants done / total, for the progress fill. */
  done: number;
  total: number;
  /** Latest descendant due date (shows when child work overruns the parent). */
  latestChildDue: string | null;
  /** True for other-track items shown only because they're linked. */
  linked?: boolean;
};

export type GanttDep = {
  from: string;
  to: string;
  health: "conflict" | "overdue" | "tight" | "unknown" | "ok" | "done";
  reason: string;
  slipDays: number | null;
  href: string;
};

export type Zoom = "week" | "month" | "quarter";

/* --------------------------------------------------------------- geometry */

const ROW_H = 34;
const LABEL_W = 360;
const HEADER_H = 52;
const SECTION_H = 28;
const DAY = 86_400_000;
const ZOOM_PX: Record<Zoom, number> = { week: 18, month: 5, quarter: 2 };

const toDay = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY);
const isoOf = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const fmt = (iso: string | null, year = false) =>
  iso
    ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" })
    : "No date";
const isMilestone = (l: Level) => l === "cpm" || l === "ipm" || l === "ipm_intent" || l === "outcome";

/* ----------------------------------------------------------------- colors */

const HEALTH: Record<GanttDep["health"], { color: string; label: string }> = {
  conflict: { color: "var(--critical)", label: "Conflict" },
  overdue: { color: "var(--serious)", label: "Overdue" },
  tight: { color: "#c98500", label: "Tight" },
  unknown: { color: "var(--muted)", label: "No date" },
  ok: { color: "var(--line-strong)", label: "On track" },
  done: { color: "var(--good)", label: "Done" },
};

function barColor(it: GanttItem) {
  if (it.linked || !it.inScope) return { fill: "var(--line-strong)", strong: "var(--muted)" };
  if (it.level === "story") return { fill: "var(--progress-active)", strong: "var(--accent)" };
  if (it.level === "cpm" || it.level === "outcome") return { fill: "var(--foreground)", strong: "var(--foreground)" };
  return { fill: "#9cc2f0", strong: "var(--accent)" };
}

/* ------------------------------------------------------------------- view */

export function Gantt({
  items,
  deps,
  today,
  initialZoom = "month",
  showDeps = true,
}: {
  items: GanttItem[];
  deps: GanttDep[];
  today: string;
  initialZoom?: Zoom;
  showDeps?: boolean;
}) {
  const router = useRouter();
  const [zoom, setZoom] = useState<Zoom>(initialZoom);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [tip, setTip] = useState<{ key: string; x: number; y: number; up: boolean; left: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = ZOOM_PX[zoom];

  /* ---- structure */
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const children = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of items) if (i.parentKey) m.set(i.parentKey, [...(m.get(i.parentKey) ?? []), i.key]);
    return m;
  }, [items]);
  const preds = useMemo(() => group(deps, "to", "from"), [deps]);
  const succs = useMemo(() => group(deps, "from", "to"), [deps]);

  const visible = useMemo(() => {
    const out: GanttItem[] = [];
    const hidden = new Set<string>();
    for (const i of items) {
      if (i.parentKey && (hidden.has(i.parentKey) || collapsed.has(i.parentKey))) {
        hidden.add(i.key);
        continue;
      }
      out.push(i);
    }
    return out;
  }, [items, collapsed]);
  const rowOf = useMemo(() => new Map(visible.map((r, i) => [r.key, i])), [visible]);
  const firstLinked = visible.findIndex((r) => r.linked);

  /* ---- what the focused item is connected to */
  const focus = selected ?? hover;
  const related = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (let p = byKey.get(focus)?.parentKey; p; p = byKey.get(p)?.parentKey) s.add(p);
    const down = (k: string) => (children.get(k) ?? []).forEach((c) => (s.add(c), down(c)));
    down(focus);
    for (const k of preds.get(focus) ?? []) s.add(k);
    for (const k of succs.get(focus) ?? []) s.add(k);
    return s;
  }, [focus, byKey, children, preds, succs]);

  /* ---- time scale */
  const { min, max } = useMemo(() => {
    const ds = items.flatMap((i) => [i.start, i.due]).filter((d): d is string => !!d).map(toDay);
    ds.push(toDay(today));
    return { min: Math.min(...ds) - 21, max: Math.max(...ds) + 35 };
  }, [items, today]);
  const x = useCallback((iso: string) => (toDay(iso) - min) * px, [min, px]);
  const width = (max - min) * px;
  const height = visible.length * ROW_H + (firstLinked >= 0 ? SECTION_H : 0);
  const yMid = (row: number) => row * ROW_H + ROW_H / 2 + (firstLinked >= 0 && row >= firstLinked ? SECTION_H : 0);

  const scale = useMemo(() => buildScale(min, max, zoom), [min, max, zoom]);

  const geom = (it: GanttItem) => {
    const s = it.start ?? it.due;
    const e = it.due ?? it.start;
    if (!s || !e) return null;
    const x1 = x(s);
    return { x1, x2: Math.max(x(e) + px, x1 + 4) };
  };

  /* ---- scroll to today on load and zoom change */
  const scrollToToday = useCallback(
    (smooth = false) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ left: Math.max(0, x(today) - (el.clientWidth - LABEL_W) * 0.3), behavior: smooth ? "smooth" : "auto" });
    },
    [x, today],
  );
  useEffect(() => scrollToToday(), [scrollToToday]);

  const scrollToRow = (key: string) => {
    // Expand collapsed ancestors so the row exists.
    const anc: string[] = [];
    for (let p = byKey.get(key)?.parentKey; p; p = byKey.get(p)?.parentKey) anc.push(p);
    if (anc.some((a) => collapsed.has(a))) setCollapsed((c) => new Set([...c].filter((k) => !anc.includes(k))));
    setSelected(key);
    requestAnimationFrame(() => {
      const el = scroller.current;
      const row = document.getElementById(`gantt-row-${key}`);
      const it = byKey.get(key);
      if (!el || !row) return;
      const g = it && geom(it);
      el.scrollTo({
        top: row.offsetTop - el.clientHeight / 2,
        left: g ? Math.max(0, g.x1 - (el.clientWidth - LABEL_W) * 0.3) : el.scrollLeft,
        behavior: "smooth",
      });
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- arrows */
  const arrows = deps.flatMap((d) => {
    const touches = focus && (d.from === focus || d.to === focus);
    if (!showDeps && !touches) return [];
    const pr = rowOf.get(d.from);
    const sr = rowOf.get(d.to);
    const p = byKey.get(d.from);
    const s = byKey.get(d.to);
    if (pr === undefined || sr === undefined || !p || !s) return [];
    const pg = geom(p);
    const sg = geom(s);
    if (!pg || !sg) return [];
    const x1 = isMilestone(p.level) && p.due ? x(p.due) + px / 2 + 7 : pg.x2;
    const x2 = isMilestone(s.level) && s.due ? x(s.due) + px / 2 - 8 : sg.x1 - 1;
    return [{ d, path: route(x1, yMid(pr), x2, yMid(sr)), touches: !!touches }];
  });

  const sel = selected ? byKey.get(selected) : null;
  const tipItem = tip ? byKey.get(tip.key) : null;

  const onBarMove = (e: ReactMouseEvent, key: string) => {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    setTip({ key, x, y, up: e.clientY > Math.min(box.bottom, window.innerHeight) - 230, left: x > box.width - 310 });
  };

  const toggle = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const dim = (k: string) => (related && !related.has(k) ? 0.22 : 1);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div role="group" aria-label="Zoom" className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
          {(["week", "month", "quarter"] as Zoom[]).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                (zoom === z ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg")
              }
            >
              {z === "week" ? "Weeks" : z === "month" ? "Months" : "Quarters"}
            </button>
          ))}
        </div>
        <ToolButton onClick={() => scrollToToday(true)} icon={Crosshair}>
          Today
        </ToolButton>
        <ToolButton onClick={() => setCollapsed(new Set())} icon={ChevronsUpDown}>
          Expand all
        </ToolButton>
        <ToolButton
          onClick={() => setCollapsed(new Set(items.filter((i) => i.depth === 1 && children.has(i.key)).map((i) => i.key)))}
          icon={ChevronsDownUp}
        >
          Collapse to milestones
        </ToolButton>
        <Legend />
      </div>

      <div className="relative">
        <div
          ref={scroller}
          className="relative max-h-[calc(100vh-15rem)] min-h-80 overflow-auto"
          onMouseLeave={() => {
            setHover(null);
            setTip(null);
          }}
        >
          <div className="relative" style={{ width: LABEL_W + width, height: HEADER_H + height }}>
            {/* header: corner + timeline scale (sticky top) */}
            <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
              <div
                className="sticky left-0 z-10 flex shrink-0 items-end border-b border-r border-line bg-panel-2 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
                style={{ width: LABEL_W }}
              >
                Item
              </div>
              <svg width={width} height={HEADER_H} className="block shrink-0 border-b border-line bg-panel-2" aria-hidden>
                {scale.top.map((t) => (
                  <g key={"t" + t.x}>
                    <line x1={t.x * px} x2={t.x * px} y1={0} y2={HEADER_H} stroke="var(--line)" />
                    <text x={t.x * px + 6} y={18} fontSize={11} fontWeight={600} fill="var(--ink-2)">
                      {t.label}
                    </text>
                  </g>
                ))}
                {scale.bottom.map((t) => (
                  <g key={"b" + t.x}>
                    <line x1={t.x * px} x2={t.x * px} y1={28} y2={HEADER_H} stroke="var(--line)" />
                    <text x={t.x * px + 4} y={44} fontSize={10.5} fill="var(--muted)">
                      {t.label}
                    </text>
                  </g>
                ))}
                <g transform={`translate(${x(today) + px / 2},0)`}>
                  <rect x={-22} y={HEADER_H - 17} width={44} height={15} rx={7.5} fill="var(--accent)" />
                  <text y={HEADER_H - 6} fontSize={10} fontWeight={600} fill="#fff" textAnchor="middle">
                    Today
                  </text>
                </g>
              </svg>
            </div>

            <div className="flex">
              {/* labels (sticky left) */}
              <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-panel" style={{ width: LABEL_W }}>
                {visible.map((it, i) => {
                  const kids = children.has(it.key);
                  const isSel = selected === it.key;
                  return (
                    <div key={it.key}>
                      {i === firstLinked && <SectionLabel />}
                      <div
                        id={`gantt-row-${it.key}`}
                        onMouseEnter={() => setHover(it.key)}
                        onClick={() => setSelected(isSel ? null : it.key)}
                        className={
                          "group flex cursor-pointer items-center gap-1.5 border-b border-line/60 pr-2 text-[13px] transition-opacity " +
                          (isSel ? "bg-accent-soft" : hover === it.key ? "bg-panel-2" : "")
                        }
                        style={{ height: ROW_H, paddingLeft: 8 + it.depth * 16, opacity: dim(it.key) }}
                      >
                        {kids ? (
                          <button
                            type="button"
                            aria-label={collapsed.has(it.key) ? `Expand ${it.key}` : `Collapse ${it.key}`}
                            aria-expanded={!collapsed.has(it.key)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(it.key);
                            }}
                            className="rounded p-0.5 text-muted hover:bg-line/60 hover:text-fg"
                          >
                            {collapsed.has(it.key) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : (
                          <span className="w-[18px] shrink-0" />
                        )}
                        <span className="w-10 shrink-0 font-mono text-[9.5px] font-semibold tracking-wide text-muted">{LEVEL_SHORT[it.level]}</span>
                        <span
                          className={
                            "min-w-0 flex-1 truncate " +
                            (it.linked ? "text-muted " : "text-fg ") +
                            (it.level === "cpm" || it.level === "outcome" ? "font-semibold" : "")
                          }
                          title={`${it.key} · ${it.summary}`}
                        >
                          {it.summary}
                        </span>
                        <span className="shrink-0 font-mono text-[10.5px] text-muted">{it.key}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* timeline body */}
              <svg
                width={width}
                height={height}
                className="block shrink-0"
                role="img"
                aria-label="Timeline chart"
                onClick={(e) => e.target === e.currentTarget && setSelected(null)}
              >
                <defs>
                  <pattern id="gantt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="var(--panel-2)" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-strong)" strokeWidth="2" />
                  </pattern>
                  {Object.entries(HEALTH).map(([h, v]) => (
                    <marker key={h} id={`gantt-arrow-${h}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,1 L9,5 L0,9 z" fill={v.color} />
                    </marker>
                  ))}
                </defs>
                <g>
                  {/* weekends in week zoom */}
                  {zoom === "week" &&
                    scale.weekends.map((d) => <rect key={d} x={(d - min) * px} y={0} width={px * 2} height={height} fill="var(--panel-2)" />)}
                  {/* grid */}
                  {scale.bottom.map((t) => (
                    <line key={"g" + t.x} x1={t.x * px} x2={t.x * px} y1={0} y2={height} stroke="var(--line)" strokeOpacity={0.6} />
                  ))}
                  {scale.top.map((t) => (
                    <line key={"G" + t.x} x1={t.x * px} x2={t.x * px} y1={0} y2={height} stroke="var(--line-strong)" strokeOpacity={0.7} />
                  ))}
                </g>

                <g>
                  {visible.map((it, i) => {
                    const cy = yMid(i);
                    const g = geom(it);
                    const late = !!it.due && it.due < today && it.statusCategory !== "done";
                    const done = it.statusCategory === "done";
                    const c = barColor(it);
                    const isFocus = focus === it.key;
                    const overrun = it.latestChildDue && it.due && it.latestChildDue > it.due && !done;
                    return (
                      <g
                        key={it.key}
                        opacity={dim(it.key)}
                        className="cursor-pointer transition-opacity"
                        onMouseEnter={() => setHover(it.key)}
                        onMouseMove={(e) => onBarMove(e, it.key)}
                        onMouseLeave={() => setTip(null)}
                        onClick={() => setSelected(selected === it.key ? null : it.key)}
                        onDoubleClick={() => router.push(`/items/${encodeURIComponent(it.key)}`)}
                      >
                        {/* row hit area + hover band */}
                        <rect
                          x={0}
                          y={cy - ROW_H / 2}
                          width={width}
                          height={ROW_H}
                          fill={selected === it.key ? "var(--accent-soft)" : hover === it.key ? "var(--panel-2)" : "transparent"}
                          fillOpacity={selected === it.key ? 0.7 : 1}
                        />
                        {!g ? (
                          <text x={x(today) + 10} y={cy + 4} fontSize={11} fontStyle="italic" fill="var(--muted)">
                            No dates in Jira
                          </text>
                        ) : isMilestone(it.level) ? (
                          <>
                            {it.start && it.due && (
                              <rect x={g.x1} y={cy - 2} width={Math.max(g.x2 - g.x1, 2)} height={4} rx={2} fill={c.fill} opacity={0.3} />
                            )}
                            {overrun && it.due && (
                              <line
                                x1={x(it.due) + px / 2}
                                x2={x(it.latestChildDue!) + px}
                                y1={cy}
                                y2={cy}
                                stroke="var(--critical)"
                                strokeWidth={2}
                                strokeDasharray="3 3"
                              />
                            )}
                            {it.due && (
                              <path
                                d={`M${x(it.due) + px / 2},${cy - 8} l8,8 l-8,8 l-8,-8 z`}
                                fill={done ? "var(--good)" : late ? "var(--critical)" : c.strong}
                                stroke={isFocus ? "var(--accent)" : "var(--panel)"}
                                strokeWidth={isFocus ? 3 : 2}
                              />
                            )}
                            {it.due && zoom !== "quarter" && (
                              <text
                                x={(overrun ? x(it.latestChildDue!) + px : x(it.due) + px / 2) + 13}
                                y={cy + 4}
                                fontSize={11}
                                fill={late || overrun ? "var(--critical)" : "var(--ink-2)"}
                              >
                                {fmt(it.due)}
                                {overrun ? ` · work runs to ${fmt(it.latestChildDue)}` : ""}
                              </text>
                            )}
                          </>
                        ) : (
                          <>
                            <rect
                              x={g.x1}
                              y={cy - 8}
                              width={g.x2 - g.x1}
                              height={16}
                              rx={4}
                              fill={it.linked || !it.inScope ? "url(#gantt-hatch)" : done ? "var(--good)" : c.fill}
                              fillOpacity={done ? 0.55 : 1}
                              stroke={isFocus ? "var(--accent)" : late ? "var(--critical)" : it.pending ? "#c026d3" : it.linked ? "var(--line-strong)" : "none"}
                              strokeWidth={isFocus || late ? 2 : 1.25}
                              strokeDasharray={it.pending && !isFocus ? "3 2" : undefined}
                            />
                            {!done && it.total > 0 && it.done > 0 && (
                              <rect
                                x={g.x1}
                                y={cy - 8}
                                width={(g.x2 - g.x1) * (it.done / it.total)}
                                height={16}
                                rx={4}
                                fill={c.strong}
                                opacity={0.85}
                                pointerEvents="none"
                              />
                            )}
                            {g.x2 - g.x1 > 60 && it.total > 0 && it.done > 0 && (
                              <text
                                x={g.x1 + 6}
                                y={cy + 3.5}
                                fontSize={10}
                                fontWeight={600}
                                fill={it.done / it.total > 0.35 ? "#fff" : "var(--foreground)"}
                                pointerEvents="none"
                              >
                                {Math.round((it.done / it.total) * 100)}%
                              </text>
                            )}
                            {zoom !== "quarter" && (
                              <text x={g.x2 + 6} y={cy + 4} fontSize={11} fill={late ? "var(--critical)" : "var(--muted)"} pointerEvents="none">
                                {it.assignee ? `${it.assignee} · ` : ""}
                                {fmt(it.due)}
                              </text>
                            )}
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>

                {/* linked section band */}
                {firstLinked >= 0 && (
                  <rect x={0} y={firstLinked * ROW_H} width={width} height={SECTION_H} fill="var(--panel-2)" />
                )}

                {/* today */}
                <line
                  x1={x(today) + px / 2}
                  x2={x(today) + px / 2}
                  y1={0}
                  y2={height}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />

                {/* dependency arrows */}
                <g fill="none">
                  {arrows.map(({ d, path, touches }) => {
                    const p = path;
                    const faded = !!focus && !touches;
                    return (
                      <g key={`${d.from}>${d.to}`} opacity={faded ? 0.12 : 1}>
                        <path d={p} stroke="transparent" strokeWidth={10} className="cursor-pointer" onClick={() => router.push(d.href)}>
                          <title>{d.reason}</title>
                        </path>
                        <path
                          d={p}
                          stroke={HEALTH[d.health].color}
                          strokeWidth={touches ? 2.5 : 1.5}
                          strokeDasharray={d.health === "unknown" ? "4 3" : undefined}
                          markerEnd={`url(#gantt-arrow-${d.health})`}
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
          </div>
        </div>

        {/* hover card */}
        {tipItem && tip && !selected && (
          <HoverCard item={tipItem} pos={tip} preds={preds.get(tipItem.key)?.length ?? 0} succs={succs.get(tipItem.key)?.length ?? 0} today={today} />
        )}

        {/* detail panel */}
        {sel && (
          <DetailPanel
            item={sel}
            today={today}
            byKey={byKey}
            deps={deps}
            kids={children.get(sel.key) ?? []}
            onClose={() => setSelected(null)}
            onGo={scrollToRow}
          />
        )}
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-muted">
        Hover to trace what an item is connected to. Click to pin it and see details; double-click to open it. Click an arrow to open that dependency.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function group(deps: GanttDep[], by: "from" | "to", val: "from" | "to") {
  const m = new Map<string, string[]>();
  for (const d of deps) m.set(d[by], [...(m.get(d[by]) ?? []), d[val]]);
  return m;
}

/** A smooth connector from the end of one bar to the start of another. */
function route(x1: number, y1: number, x2: number, y2: number) {
  if (y1 === y2) return `M${x1},${y1} L${x2},${y2}`;
  if (x2 - x1 >= 24) {
    const dx = Math.min(48, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  // Successor starts before the predecessor ends: loop around.
  const midY = y1 + (y2 > y1 ? ROW_H / 2 : -ROW_H / 2);
  const r = 6;
  const sgn = y2 > y1 ? 1 : -1;
  return [
    `M${x1},${y1}`,
    `H${x1 + 10 - r}`,
    `Q${x1 + 10},${y1} ${x1 + 10},${y1 + sgn * r}`,
    `V${midY - sgn * r}`,
    `Q${x1 + 10},${midY} ${x1 + 10 - r},${midY}`,
    `H${x2 - 12 + r}`,
    `Q${x2 - 12},${midY} ${x2 - 12},${midY + sgn * r}`,
    `V${y2 - sgn * r}`,
    `Q${x2 - 12},${y2} ${x2 - 12 + r},${y2}`,
    `H${x2}`,
  ].join(" ");
}

type Tick = { x: number; label: string };

/** Two-tier time scale. Positions are in days from `min`. */
function buildScale(min: number, max: number, zoom: Zoom) {
  const top: Tick[] = [];
  const bottom: Tick[] = [];
  const weekends: number[] = [];
  const startDate = new Date(isoOf(min) + "T00:00:00Z");
  const months = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const m0 = months(startDate);
  for (let m = m0; ; m++) {
    const d = new Date(Date.UTC(Math.floor(m / 12), m % 12, 1));
    const day = Math.floor(d.getTime() / DAY);
    if (day > max) break;
    const pos = day - min;
    const label = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const year = d.getUTCFullYear();
    if (zoom === "week") {
      if (pos >= 0) top.push({ x: pos, label: `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${year}` });
    } else if (zoom === "month") {
      if (d.getUTCMonth() % 3 === 0 && pos >= 0) top.push({ x: pos, label: `Q${d.getUTCMonth() / 3 + 1} ${year}` });
      if (pos >= 0) bottom.push({ x: pos, label });
    } else {
      if (d.getUTCMonth() === 0 && pos >= 0) top.push({ x: pos, label: String(year) });
      if (d.getUTCMonth() % 3 === 0 && pos >= 0) bottom.push({ x: pos, label: `Q${d.getUTCMonth() / 3 + 1}` });
    }
  }
  if (zoom === "week") {
    for (let d = min; d <= max; d++) {
      const dow = new Date(d * DAY).getUTCDay();
      if (dow === 1) bottom.push({ x: d - min, label: String(new Date(d * DAY).getUTCDate()) });
      if (dow === 6) weekends.push(d);
    }
  }
  if (top.length === 0 || top[0].x > 0) {
    const d = startDate;
    top.unshift({
      x: 0,
      label:
        zoom === "quarter"
          ? String(d.getUTCFullYear())
          : zoom === "month"
            ? `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
            : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return { top, bottom, weekends };
}

/* ---------------------------------------------------------------- pieces */

function ToolButton({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof Crosshair; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink-2 shadow-sm transition hover:border-line-strong hover:text-fg"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </button>
  );
}

function Legend() {
  const sw = "inline-block h-2.5 w-5 rounded-sm";
  return (
    <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className={sw} style={{ background: "#9cc2f0" }} />
        <span className={sw + " -ml-1.5"} style={{ background: "var(--accent)", width: 10 }} />
        Work (filled = done)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden>
          <path d="M6,0 l6,6 l-6,6 l-6,-6 z" fill="var(--foreground)" />
        </svg>
        Milestone
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={sw} style={{ background: "repeating-linear-gradient(45deg, var(--panel-2) 0 3px, var(--line-strong) 3px 5px)" }} />
        Other track
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={sw} style={{ border: "2px solid var(--critical)" }} />
        Past due
      </span>
      {(["conflict", "overdue", "tight", "ok"] as const).map((h) => (
        <span key={h} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: HEALTH[h].color }} />
          {HEALTH[h].label}
        </span>
      ))}
    </div>
  );
}

function SectionLabel() {
  return (
    <div style={{ height: SECTION_H }} className="flex items-center border-b border-line bg-panel-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
      Linked work on other tracks
    </div>
  );
}

function statusTone(it: GanttItem, today: string) {
  if (it.statusCategory === "done") return { cls: "bg-good-soft text-good-ink", label: it.status };
  if (it.due && it.due < today) return { cls: "bg-critical-soft text-critical-ink", label: `${it.status} · past due` };
  if (it.statusCategory === "indeterminate") return { cls: "bg-accent-soft text-accent", label: it.status };
  return { cls: "bg-panel-2 text-ink-2", label: it.status };
}

function HoverCard({
  item,
  pos,
  preds,
  succs,
  today,
}: {
  item: GanttItem;
  pos: { x: number; y: number; up: boolean; left: boolean };
  preds: number;
  succs: number;
  today: string;
}) {
  const t = statusTone(item, today);
  return (
    <div
      className="pointer-events-none absolute z-40 w-72 rounded-lg border border-line bg-panel p-3 text-xs shadow-pop"
      style={{
        left: pos.left ? undefined : pos.x + 16,
        right: pos.left ? `calc(100% - ${pos.x - 16}px)` : undefined,
        top: pos.up ? undefined : pos.y + 18,
        bottom: pos.up ? `calc(100% - ${pos.y - 12}px)` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-semibold text-accent">{item.key}</span>
        <span className="text-muted">{LEVEL_LABEL[item.level]}</span>
      </div>
      <div className="mt-1 text-[13px] font-medium leading-snug text-fg">{item.summary}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + t.cls}>{t.label}</span>
        {item.total > 0 && (
          <span className="text-muted">
            {item.done}/{item.total} done
          </span>
        )}
      </div>
      <div className="mt-2 text-ink-2">
        {fmt(item.start, true)} <ArrowRight className="inline h-3 w-3" aria-hidden /> {fmt(item.due, true)}
      </div>
      {(item.assignee || item.team) && <div className="mt-0.5 text-muted">{[item.assignee, item.team].filter(Boolean).join(" · ")}</div>}
      {(preds > 0 || succs > 0) && (
        <div className="mt-1 text-muted">
          {preds > 0 && `Depends on ${preds} ${preds === 1 ? "item" : "items"}`}
          {preds > 0 && succs > 0 && " · "}
          {succs > 0 && `${succs} ${succs === 1 ? "item depends" : "items depend"} on it`}
        </div>
      )}
      <div className="mt-2 text-[11px] text-muted">Click for details</div>
    </div>
  );
}

function DetailPanel({
  item,
  today,
  byKey,
  deps,
  kids,
  onClose,
  onGo,
}: {
  item: GanttItem;
  today: string;
  byKey: Map<string, GanttItem>;
  deps: GanttDep[];
  kids: string[];
  onClose: () => void;
  onGo: (key: string) => void;
}) {
  const t = statusTone(item, today);
  const chain: GanttItem[] = [];
  for (let p = item.parentKey; p; p = byKey.get(p)?.parentKey ?? null) {
    const it = byKey.get(p);
    if (it) chain.unshift(it);
  }
  const incoming = deps.filter((d) => d.to === item.key);
  const outgoing = deps.filter((d) => d.from === item.key);
  const overrun = item.latestChildDue && item.due && item.latestChildDue > item.due && item.statusCategory !== "done";

  const ItemLink = ({ k }: { k: string }) => {
    const it = byKey.get(k);
    return (
      <button type="button" onClick={() => onGo(k)} className="group flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-panel-2">
        <span className="shrink-0 font-mono text-[10.5px] text-accent">{k}</span>
        <span className="truncate text-ink-2 group-hover:text-fg">{it?.summary ?? ""}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted">{fmt(it?.due ?? null)}</span>
      </button>
    );
  };

  const DepRow = ({ d, other }: { d: GanttDep; other: string }) => (
    <li className="rounded-md border border-line p-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: HEALTH[d.health].color }} />
        <span className="text-[11px] font-medium text-ink-2">{HEALTH[d.health].label}</span>
        <Link href={d.href} className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
          Open dependency <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <ItemLink k={other} />
      <p className="px-1.5 text-[11.5px] leading-snug text-muted">{d.reason}</p>
    </li>
  );

  return (
    <aside
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-1.5rem)] w-[min(380px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-pop"
      aria-label={`${item.key} details`}
    >
      <div className="flex items-start gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-semibold text-accent">{item.key}</span>
            <span className="text-muted">{LEVEL_LABEL[item.level]}</span>
          </div>
          <h3 className="mt-0.5 text-sm font-semibold leading-snug text-fg">{item.summary}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4 overflow-y-auto p-3 text-[13px]">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field label="Status">
            <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + t.cls}>{t.label}</span>
          </Field>
          <Field label="Owner">{item.assignee ?? "Unassigned"}</Field>
          <Field label="Start">{fmt(item.start, true)}</Field>
          <Field label="Due">{fmt(item.due, true)}</Field>
          {item.team && <Field label="Team">{item.team}</Field>}
          {item.total > 0 && (
            <Field label="Progress">
              {item.done} of {item.total} done ({Math.round((item.done / item.total) * 100)}%)
            </Field>
          )}
        </div>
        {overrun && (
          <p className="rounded-md bg-critical-soft px-2.5 py-2 text-[12px] text-critical-ink">
            Child work runs to {fmt(item.latestChildDue, true)}, past this item&rsquo;s due date of {fmt(item.due, true)}.
          </p>
        )}
        {item.pending && <p className="rounded-md bg-accent-soft px-2.5 py-2 text-[12px] text-accent">Has local edits not yet pushed to Jira.</p>}

        {chain.length > 0 && (
          <Section title="Part of">
            {chain.map((c) => (
              <ItemLink key={c.key} k={c.key} />
            ))}
          </Section>
        )}
        {incoming.length > 0 && (
          <Section title={`Depends on (${incoming.length})`}>
            <ul className="grid gap-1.5">
              {incoming.map((d) => (
                <DepRow key={d.from} d={d} other={d.from} />
              ))}
            </ul>
          </Section>
        )}
        {outgoing.length > 0 && (
          <Section title={`Needed by (${outgoing.length})`}>
            <ul className="grid gap-1.5">
              {outgoing.map((d) => (
                <DepRow key={d.to} d={d} other={d.to} />
              ))}
            </ul>
          </Section>
        )}
        {kids.length > 0 && (
          <Section title={`Contains (${kids.length})`}>
            {kids.slice(0, 12).map((k) => (
              <ItemLink key={k} k={k} />
            ))}
            {kids.length > 12 && <p className="px-1.5 text-xs text-muted">and {kids.length - 12} more</p>}
          </Section>
        )}
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Link
          href={`/items/${encodeURIComponent(item.key)}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          Open item <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 truncate text-fg">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="grid gap-0.5">{children}</div>
    </section>
  );
}
