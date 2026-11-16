import { itemContext, contextLine, type ContextData } from "./context";
import { needByDate, type Dependency } from "./dependencies";
import { flattenTree, isLate, type TreeNode } from "./hierarchy";
import { ancestry, depHref, type Severity } from "./insights";
import { matchesFilter, type Filter, type Model, type Rag } from "./model";
import type { ProgramAction } from "./programActions";
import type { IssueView } from "./store";

/**
 * A briefing: a one-sentence status line plus specific call-outs, written as
 * sentences a lead can read out. Three groups:
 *  - attention: what threatens the plan, and why
 *  - help: where something is stuck or missing and needs someone to step in
 *  - progress: what moved forward recently
 */
export type CalloutKind = "attention" | "help" | "progress";

export type Callout = {
  id: string;
  kind: CalloutKind;
  severity: Severity;
  title: string;
  body: string[];
  href: string;
  weight: number;
};

export type Brief = {
  /** "Off track for Dashboard: …" */
  headline: string;
  /** The same sentence without the status prefix, for pages that show status separately. */
  summary: string;
  callouts: Callout[];
};

const DAY = 86_400_000;
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "no date";
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** "[View Account] Balances API v3" → team "View Account", name "Balances API v3". */
export function describe(i: IssueView) {
  const m = i.summary.match(/^\[([^\]]+)\]\s*(.*)$/);
  const name = m ? m[2] : i.summary;
  const team = m ? m[1] : i.inScope ? null : i.key.split("-")[0];
  return { name, team, ref: `${name} (${i.key})` };
}

export function buildBrief(
  m: Model,
  f: Filter,
  data: ContextData & { programs?: ProgramAction[] },
  opts: { rag: Rag; subject: string },
): Brief {
  const today = m.today;
  const inView = (k: string) => matchesFilter(m, k, f);
  const up = ancestry(m);
  const ctxFor = (keys: string[], extra: string[] = []) => itemContext(keys, data, today, extra);
  const line = (keys: string[], extra: string[] = []) => contextLine(ctxFor(keys, extra), today);
  const out: Callout[] = [];
  const recent = (iso: string, n: number) => iso >= new Date(Date.parse(today) - n * DAY).toISOString();

  // ---------- attention: cross-track conflicts, grouped by the milestone they threaten
  const conflicts = m.deps.filter(
    (d) => (d.health === "conflict" || d.health === "overdue") && d.direction !== "outgoing" && (inView(d.successor.key) || inView(d.predecessor.key)),
  );
  const byCpm = new Map<string, { cpm: IssueView | null; deps: Dependency[] }>();
  for (const d of conflicts) {
    const cpm = up(d.successor.key).cpm ?? null;
    const k = cpm?.key ?? `none:${d.successor.key}`;
    byCpm.set(k, { cpm, deps: [...(byCpm.get(k)?.deps ?? []), d] });
  }
  const threatened: { cpm: IssueView; cause: string }[] = [];
  for (const { cpm, deps } of byCpm.values()) {
    const body: string[] = [];
    let cause = "";
    for (const d of deps.slice(0, 2)) {
      const p = describe(d.predecessor);
      const s = describe(d.successor);
      const from = p.team ? `${p.team}'s ` : "";
      const sentence =
        d.health === "conflict"
          ? `${from}${p.ref} lands ${fmt(d.predecessor.dueDate)}, ${plural(d.slipDays ?? 0, "day")} after ${s.ref} needs it (${fmt(needByDate(d.successor))}).`
          : `${from}${p.ref} was due ${fmt(d.predecessor.dueDate)} and isn't done; ${s.ref} is waiting on it.`;
      body.push(sentence);
      cause ||= d.health === "conflict" ? `${p.team ?? "a dependency"} ${p.team ? "is" : "lands"} ${plural(d.slipDays ?? 0, "day")} late on ${p.name}` : `${p.name} is overdue`;
      const slip = d.recentChanges.find((c) => c.key === d.predecessor.key && c.field === "dueDate" && c.oldValue && c.newValue && c.newValue > c.oldValue);
      if (slip) body.push(`It moved out ${plural(days(slip.oldValue!, slip.newValue!), "day")} on ${fmt(slip.detectedAt)} (was ${fmt(slip.oldValue)}).`);
      body.push(line([d.predecessor.key, d.successor.key], [`dep:${d.predecessor.key}:${d.successor.key}`]) ?? "No action item or update on record yet: it needs an owner and an escalation path.");
    }
    const title = cpm
      ? `${describe(cpm).name} (${cpm.key}, due ${fmt(cpm.dueDate)}) is at risk from ${deps.length === 1 ? "a cross-track dependency" : `${deps.length} dependencies`}`
      : `${describe(deps[0].successor).name} is blocked by a late dependency`;
    if (cpm) threatened.push({ cpm, cause });
    out.push({
      id: `cpm-${cpm?.key ?? deps[0].successor.key}`,
      kind: "attention",
      severity: cpm ? "critical" : "serious",
      title,
      body,
      href: depHref(deps[0]),
      weight: 1000 + Math.max(...deps.map((d) => d.slipDays ?? 0)),
    });
  }

  // ---------- attention: late milestones and plans that run past their dates
  const nodes = flattenTree(m.tree);
  // The latest open piece of work under a milestone, within the current view (team).
  const latestChild = (n: TreeNode): IssueView | null => {
    let best: IssueView | null = null;
    const walk = (list: TreeNode[]) => {
      for (const c of list) {
        if (c.issue.dueDate && c.issue.statusCategory !== "done" && inView(c.issue.key) && (!best || c.issue.dueDate > best.dueDate!)) best = c.issue;
        walk(c.children);
      }
    };
    walk(n.children);
    return best;
  };
  for (const n of nodes) {
    const i = n.issue;
    if (!i.inScope || !["cpm", "ipm_intent", "ipm"].includes(i.level) || i.statusCategory === "done" || !inView(i.key)) continue;
    const isCpm = i.level === "cpm";
    if (isLate(i, today)) {
      out.push({
        id: `late-${i.key}`,
        kind: "attention",
        severity: isCpm ? "critical" : "serious",
        title: `${describe(i).name} (${i.key}) is ${plural(days(i.dueDate!, today), "day")} past due`,
        body: [`It was due ${fmt(i.dueDate)} and is still ${i.status}${i.assignee ? `; ${i.assignee} owns it` : ""}.`, line([i.key]) ?? "No recovery plan is on record."],
        href: `/items/${i.key}`,
        weight: 800 + days(i.dueDate!, today),
      });
    } else if (n.rollup.latestChildDue && i.dueDate && n.rollup.latestChildDue > i.dueDate) {
      const child = latestChild(n);
      // In a team view, only flag it when this team's own work is what runs late.
      const filtered = !!(f.subTrack || f.platform);
      if (filtered && (!child || child.dueDate! <= i.dueDate)) continue;
      const over = days(i.dueDate, filtered && child ? child.dueDate! : n.rollup.latestChildDue);
      out.push({
        id: `overrun-${i.key}`,
        kind: "attention",
        severity: isCpm ? "critical" : "warning",
        title: `The plan for ${describe(i).name} (${i.key}) runs ${plural(over, "day")} past its ${fmt(i.dueDate)} date`,
        body: [
          child
            ? `The last piece is ${describe(child).name} (${child.key}${child.assignee ? `, ${child.assignee}` : ""}), due ${fmt(child.dueDate)}.`
            : `Work underneath runs to ${fmt(n.rollup.latestChildDue)}.`,
          line([i.key, ...(child ? [child.key] : [])]) ?? "Nobody has recorded a re-plan or descope option yet.",
        ],
        href: `/items/${i.key}`,
        weight: (isCpm ? 600 : 300) + over,
      });
    }
  }

  // ---------- attention: other tracks needing our work sooner than planned
  for (const d of m.deps.filter((x) => x.health === "conflict" && x.direction === "outgoing" && inView(x.predecessor.key))) {
    const s = describe(d.successor);
    out.push({
      id: `out-${d.predecessor.key}-${d.successor.key}`,
      kind: "attention",
      severity: "serious",
      title: `${s.team ?? "Another track"} needs ${describe(d.predecessor).name} (${d.predecessor.key}) ${plural(d.slipDays ?? 0, "day")} sooner than planned`,
      body: [`${s.ref} needs it by ${fmt(d.successor.startDate ?? d.successor.dueDate)}; it's planned for ${fmt(d.predecessor.dueDate)}.`, line([d.predecessor.key, d.successor.key]) ?? "No agreed plan with that team is on record."],
      href: depHref(d),
      weight: 500 + (d.slipDays ?? 0),
    });
  }

  // ---------- help: blocked or stalled, per the latest update
  const latest = new Map<string, (typeof data.updates)[number]>();
  for (const u of data.updates) if (!latest.has(u.key) || u.createdAt > latest.get(u.key)!.createdAt) latest.set(u.key, u);
  for (const [key, u] of latest) {
    if (u.progress !== "blocked" && u.progress !== "stalled") continue;
    const dep = key.match(/^dep:([^:]+):([^:]+)$/);
    const subject = dep ? m.byKey.get(dep[1]) : m.byKey.get(key);
    if (!subject || (dep ? !inView(dep[2]) && !inView(dep[1]) : !inView(key))) continue;
    if (subject.statusCategory === "done") continue;
    out.push({
      id: `stuck-${key}`,
      kind: "help",
      severity: u.progress === "blocked" ? "serious" : "warning",
      title: `${u.progress === "blocked" ? "Blocked" : "Stalled"}: ${describe(subject).name} (${subject.key})`,
      body: [`"${clip(u.body, 110)}" (${fmt(u.createdAt)})`, subject.assignee ? `Owner: ${subject.assignee}. Who can unblock it?` : "It has no owner."],
      href: dep ? `/dependencies/${dep[1]}/${dep[2]}` : `/items/${key}`,
      weight: (u.progress === "blocked" ? 400 : 250) + days(u.createdAt, today),
    });
  }

  // ---------- help: other tracks with no committed date
  for (const d of m.deps.filter((x) => x.health === "unknown" && x.direction === "incoming" && inView(x.successor.key))) {
    const p = describe(d.predecessor);
    out.push({
      id: `nodate-${d.predecessor.key}`,
      kind: "help",
      severity: "warning",
      title: `No committed date from ${p.team ?? "the owning team"} for ${p.name} (${d.predecessor.key})`,
      body: [
        needByDate(d.successor) && needByDate(d.successor)! < today
          ? `${describe(d.successor).ref} needed it by ${fmt(needByDate(d.successor))}, so it's already holding up work.`
          : `${describe(d.successor).ref} needs it by ${fmt(needByDate(d.successor))}.`,
        line([d.predecessor.key, d.successor.key]) ?? "Nobody is chasing it yet.",
      ],
      href: depHref(d),
      weight: 200,
    });
  }

  // ---------- help: decisions due soon, and multi-track risks gone quiet
  const stale = m.cfg.analysis.staleDays ?? 7;
  for (const i of m.issues) {
    if (i.statusCategory === "done" || !inView(i.key)) continue;
    const u = latest.get(i.key);
    if (u?.progress === "resolved") continue;
    const lastActivity = [u?.createdAt, i.updatedAt].filter((x): x is string => !!x).sort().pop() ?? null;
    if (i.level === "decision" && i.dueDate && days(today, i.dueDate) <= 14) {
      const left = days(today, i.dueDate);
      out.push({
        id: `decision-${i.key}`,
        kind: "help",
        severity: left < 0 ? "serious" : "warning",
        title: left < 0 ? `Decision overdue by ${plural(-left, "day")}: ${i.summary}` : `Decision needed by ${fmt(i.dueDate)}: ${i.summary}`,
        body: [`${i.key}${i.tier ? `, tier ${i.tier}` : ""}, owned by ${i.assignee ?? "nobody yet"}.`, line([i.key]) ?? "No options paper or update is on record."],
        href: `/items/${i.key}`,
        weight: 300 - left,
      });
    } else if (
      i.level === "risk" &&
      (i.tier === 1 || i.tier === 2) &&
      u?.progress !== "blocked" &&
      u?.progress !== "stalled" && // already called out as stuck
      (!lastActivity || days(lastActivity, today) >= stale)
    ) {
      out.push({
        id: `quiet-${i.key}`,
        kind: "help",
        severity: i.tier === 1 ? "serious" : "warning",
        title: `Tier ${i.tier} risk with no update in ${lastActivity ? plural(days(lastActivity, today), "day") : "a while"}: ${i.summary}`,
        body: [`${i.key}, owned by ${i.assignee ?? "nobody yet"}${i.dueDate ? `, mitigation due ${fmt(i.dueDate)}` : ""}.`, line([i.key]) ?? "Ask the owner for the current mitigation status."],
        href: `/items/${i.key}`,
        weight: 150 + (3 - i.tier) * 50,
      });
    }
  }

  // ---------- help: overdue actions and program asks
  const overdue = data.actions.filter(
    (a) => a.kind === "team" && a.status === "open" && a.dueDate && a.dueDate < today && (a.links.some(inView) || (!a.links.length && (!f.subTrack || a.subTrack === f.subTrack) && (!f.platform || a.platform === f.platform))),
  );
  if (overdue.length) {
    out.push({
      id: "overdue-actions",
      kind: "help",
      severity: "warning",
      title: `${plural(overdue.length, "action item")} overdue`,
      body: overdue.slice(0, 3).map((a) => `"${clip(a.text, 70)}" (${a.owner ?? "no owner"}, due ${fmt(a.dueDate)})`),
      href: "/actions",
      weight: 120 + overdue.length,
    });
  }
  for (const p of (data.programs ?? []).filter((x) => x.late)) {
    const pending = p.assignments.filter((a) => a.status !== "done").map((a) => a.scope.name);
    if (f.subTrack && !pending.includes(f.subTrack)) continue;
    if (f.platform && !pending.includes(f.platform)) continue;
    out.push({
      id: `ask-${p.parent}`,
      kind: "help",
      severity: "warning",
      title: `Program ask overdue: ${p.title}`,
      body: [`Due ${fmt(p.dueDate)}; ${p.done} of ${p.total} teams done.${pending.length ? ` Still open: ${pending.join(", ")}.` : ""}`],
      href: "/actions",
      weight: 110,
    });
  }

  // ---------- progress: what moved forward
  for (const c of m.changes) {
    const i = m.byKey.get(c.key);
    if (!i || !inView(i.key) || !recent(c.detectedAt, 14)) continue;
    if (c.field === "status" && i.statusCategory === "done" && ["cpm", "ipm_intent", "ipm", "epic"].includes(i.level)) {
      out.push({ id: `done-${c.id}`, kind: "progress", severity: "good", title: `${describe(i).name} (${i.key}) completed`, body: [`Closed ${fmt(c.detectedAt)}.`], href: `/items/${i.key}`, weight: 50 });
    }
  }
  for (const d of m.deps.filter((x) => inView(x.successor.key) || inView(x.predecessor.key))) {
    const pulled = d.recentChanges.find((c) => c.key === d.predecessor.key && c.field === "dueDate" && c.oldValue && c.newValue && c.newValue < c.oldValue);
    if (pulled) {
      out.push({ id: `pullin-${pulled.id}`, kind: "progress", severity: "good", title: `${describe(d.predecessor).ref} pulled in ${plural(days(pulled.newValue!, pulled.oldValue!), "day")}`, body: [`Now due ${fmt(pulled.newValue)} (was ${fmt(pulled.oldValue)}).`], href: depHref(d), weight: 40 });
    }
  }
  for (const [key, u] of latest) {
    if ((u.progress !== "moving" && u.progress !== "resolved") || !recent(u.createdAt, 7)) continue;
    const dep = key.match(/^dep:([^:]+):([^:]+)$/);
    const subject = dep ? m.byKey.get(dep[1]) : m.byKey.get(key);
    if (!subject || (dep ? !inView(dep[2]) && !inView(dep[1]) : !inView(key))) continue;
    out.push({
      id: `moving-${key}`,
      kind: "progress",
      severity: "good",
      title: `${u.progress === "resolved" ? "Resolved" : "Moving"}: ${describe(subject).name} (${subject.key})`,
      body: [`"${clip(u.body, 110)}" (${fmt(u.createdAt)})`],
      href: dep ? `/dependencies/${dep[1]}/${dep[2]}` : `/items/${key}`,
      weight: 30,
    });
  }

  // De-duplicate (a late item may also be blocked), then rank within each group.
  const callouts = [...new Map(out.map((c) => [c.id, c])).values()].sort((a, b) => b.weight - a.weight);

  // ---------- headline: one specific sentence, then what needs help
  const word = opts.rag === "red" ? "Off track" : opts.rag === "amber" ? "At risk" : "On track";
  const help = callouts.filter((c) => c.kind === "help");
  const attention = callouts.filter((c) => c.kind === "attention");
  let lead: string;
  if (threatened.length) {
    const t = threatened[0];
    lead = `${describe(t.cpm).name} (due ${fmt(t.cpm.dueDate)}) is threatened because ${t.cause}`;
    if (threatened.length > 1) lead += `, and ${plural(threatened.length - 1, "other critical path milestone")} ${threatened.length === 2 ? "is" : "are"} also exposed`;
  } else if (attention[0]) {
    lead = attention[0].title;
  } else {
    const next = m.issues
      .filter((i) => i.inScope && i.level === "cpm" && i.statusCategory !== "done" && i.dueDate && inView(i.key))
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
    lead = next ? `No critical path milestone is threatened; next up is ${describe(next).name} on ${fmt(next.dueDate)}` : "No critical path milestone is threatened";
  }
  const tail = help.length
    ? ` ${plural(help.length, "item")} need${help.length === 1 ? "s" : ""} help; most urgent: ${help[0].title}.`
    : "";
  return { headline: `${word} for ${opts.subject}: ${lead}.${tail}`, summary: `${lead}.${tail}`, callouts };
}
