import type Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { buildBrief } from "../brief";
import { itemContext } from "../context";
import { flattenTree } from "../hierarchy";
import { depHref } from "../insights";
import { matchesFilter, type Filter, type Model } from "../model";
import { normText } from "../noteMatch";
import { listProgramActions } from "../programActions";
import { listActionItems, listChanges, listItemUpdates, listNotes } from "../store";
import type { IssueView } from "../store";
import { LEVEL_LABEL, type ActionItem, type UpdateProgress } from "../types";

/**
 * The assistant's tools. Read tools answer from the local database. The one
 * write-shaped tool, propose_changes, never writes: it records a proposal that
 * the user reviews and stages from the chat panel.
 */

export type ProposedChange =
  | { kind: "field"; key: string; field: "dueDate" | "startDate" | "status"; value: string; current: string | null; reason: string }
  | { kind: "comment"; key: string; body: string; reason: string }
  | { kind: "update"; key: string; progress: UpdateProgress | null; body: string; reason: string }
  | { kind: "action"; text: string; owner: string | null; dueDate: string | null; team: string | null; links: string[]; reason: string }
  | { kind: "actionDone"; id: number; text: string; reason: string };

export type ToolContext = { db: DatabaseSync; m: Model; proposals: ProposedChange[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = { type: "string" } as const;
const teamProp = {
  type: "string",
  description: "Optional sub-track or platform name to scope the results to (as listed in the system prompt).",
} as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_items",
    description:
      "Find Jira items (outcomes, critical path milestones, interim milestones, epics, stories, risks, decisions, and linked items on other tracks) by words in their summary or by key. Returns key, level, summary, status, dates, owner and team. Use this first when the user names something without a key.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words from the summary, or a Jira key." },
        level: {
          type: "string",
          enum: ["outcome", "cpm", "ipm_intent", "ipm", "epic", "story", "risk", "decision"],
          description: "Optional: only this level.",
        },
        team: teamProp,
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_item",
    description:
      "Everything known about one Jira item: details, where it sits in the plan (parents, children progress), its dependencies with health, recent date/status changes, linked action items, status updates, and meeting-note lines that mention it.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string", description: "Jira key, e.g. BIGP-11." } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "get_briefing",
    description:
      "The current status briefing for the whole track or one team: overall status, what needs attention (threats to critical path milestones and why), what needs help (blocked, undated, overdue), and what moved forward.",
    input_schema: { type: "object", properties: { team: teamProp }, additionalProperties: false },
  },
  {
    name: "list_dependencies",
    description:
      "Dependencies (blocks / depends-on links) touching the track, with health (conflict, overdue, tight, unknown, ok, done), both sides' dates and the reason.",
    input_schema: {
      type: "object",
      properties: {
        team: teamProp,
        health: { type: "string", enum: ["conflict", "overdue", "tight", "unknown", "ok", "done"], description: "Optional filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_risks_decisions",
    description: "Open risks and decisions with tier, owner, target date, and their latest status update.",
    input_schema: {
      type: "object",
      properties: { team: teamProp, kind: { type: "string", enum: ["risk", "decision"] } },
      additionalProperties: false,
    },
  },
  {
    name: "list_action_items",
    description: "Team action items (with id, owner, due date, status, links) and program asks assigned to teams.",
    input_schema: {
      type: "object",
      properties: {
        team: teamProp,
        status: { type: "string", enum: ["open", "done", "all"], description: "Default open." },
        query: { type: "string", description: "Optional words to match in the text." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_notes",
    description: "Search meeting notes for lines containing the given words. Returns matching lines with the note title and meeting date.",
    input_schema: {
      type: "object",
      properties: { query: str },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "recent_changes",
    description: "Date and status changes detected between Jira syncs in the last N days (default 14), newest first.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90 }, team: teamProp },
      additionalProperties: false,
    },
  },
  {
    name: "propose_changes",
    description: [
      "Propose updates based on what the user told you. This does NOT change anything: the user sees each proposed change in the chat and decides what to stage.",
      "Use it whenever the user reports news that should be reflected in the plan, e.g. a new date, something done or started, a blocker, a decision, or a follow-up someone owns.",
      "Look items up first so keys and current values are right. Only propose what the user actually said or what follows directly from it; don't invent dates or owners.",
      "Kinds: field (new dueDate/startDate as YYYY-MM-DD, or status name) on a Jira item; comment (a Jira comment); update (a status note in this app, with progress moving/stalled/blocked/resolved); action (a new team action item); actionDone (mark an existing action item done, by id from list_action_items).",
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence for the user on what these changes do." },
        changes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["field", "comment", "update", "action", "actionDone"] },
              key: { type: "string", description: "Jira key (field, comment, update)." },
              field: { type: "string", enum: ["dueDate", "startDate", "status"], description: "For kind=field." },
              value: { type: "string", description: "For kind=field: YYYY-MM-DD for dates, or the status name." },
              body: { type: "string", description: "For comment/update: the text. For action: the action text." },
              progress: { type: "string", enum: ["moving", "stalled", "blocked", "resolved"], description: "For kind=update." },
              owner: { type: "string", description: "For kind=action." },
              dueDate: { type: "string", description: "For kind=action: YYYY-MM-DD." },
              team: { type: "string", description: "For kind=action: owning sub-track or platform." },
              links: { type: "array", items: str, description: "For kind=action: Jira keys it moves forward." },
              id: { type: "integer", description: "For kind=actionDone: the action item id." },
              reason: { type: "string", description: "Why, in a few words, quoting what the user said where possible." },
            },
            required: ["kind", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "changes"],
      additionalProperties: false,
    },
  },
];

// ------------------------------------------------------------------ helpers

type In = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function teamFilter(m: Model, team: string): Filter | null {
  if (!team) return {};
  if (m.subTracks.includes(team)) return { subTrack: team };
  if (m.platforms.includes(team)) return { platform: team };
  return null;
}

function brief(i: IssueView, m: Model) {
  return {
    key: i.key,
    level: LEVEL_LABEL[i.level],
    summary: i.summary,
    status: i.status,
    start: i.startDate,
    due: i.dueDate,
    owner: i.assignee,
    team: m.subTrackOf.get(i.key) ?? i.subTrack ?? null,
    platforms: i.platforms.length ? i.platforms : undefined,
    otherTrack: i.inScope ? undefined : true,
  };
}

const actionView = (a: ActionItem) => ({
  id: a.id,
  text: a.text,
  owner: a.owner,
  due: a.dueDate,
  status: a.status,
  team: a.subTrack ?? a.platform,
  links: a.links,
});

function parentsOf(m: Model) {
  const parent = new Map<string, string>();
  const walk = (nodes: Model["tree"]) => {
    for (const n of nodes) {
      for (const c of n.children) parent.set(c.issue.key, n.issue.key);
      walk(n.children);
    }
  };
  walk(m.tree);
  return parent;
}

// ------------------------------------------------------------------ executors

export function runTool(name: string, input: In, ctx: ToolContext): unknown {
  const { db, m } = ctx;
  switch (name) {
    case "search_items": {
      const f = teamFilter(m, s(input.team));
      if (!f) return { error: `Unknown team "${s(input.team)}".` };
      const q = s(input.query);
      const words = normText(q).trim().split(" ").filter(Boolean);
      const exact = m.byKey.get(q.toUpperCase());
      const hits = m.issues
        .filter((i) => !input.level || i.level === input.level)
        .filter((i) => !s(input.team) || matchesFilter(m, i.key, f))
        .map((i) => {
          const hay = normText(`${i.key} ${i.summary}`);
          const score = words.filter((w) => hay.includes(` ${w}`)).length;
          return { i, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || Number(b.i.inScope) - Number(a.i.inScope))
        .slice(0, 15)
        .map((x) => brief(x.i, m));
      if (exact && !hits.some((h) => h.key === exact.key)) hits.unshift(brief(exact, m));
      return { results: hits };
    }

    case "get_item": {
      const key = s(input.key).toUpperCase();
      const i = m.byKey.get(key);
      if (!i) return { error: `No item ${key}. Use search_items to find the key.` };
      const parent = parentsOf(m);
      const chain: ReturnType<typeof brief>[] = [];
      for (let p = parent.get(key); p; p = parent.get(p)) {
        const pi = m.byKey.get(p);
        if (pi) chain.push(brief(pi, m));
      }
      const node = flattenTree(m.tree).find((n) => n.issue.key === key);
      const deps = m.deps
        .filter((d) => d.predecessor.key === key || d.successor.key === key)
        .map((d) => ({
          dependsOn: d.successor.key === key ? brief(d.predecessor, m) : undefined,
          neededBy: d.predecessor.key === key ? brief(d.successor, m) : undefined,
          health: d.health,
          reason: d.reason,
          page: depHref(d),
        }));
      const ctx2 = itemContext([key], { actions: listActionItems(db), notes: listNotes(db), updates: listItemUpdates(db) }, m.today);
      return {
        item: { ...brief(i, m), description: i.description?.slice(0, 1500) ?? null, labels: i.labels, tier: i.tier },
        partOf: chain,
        children: node ? { total: node.rollup.total, done: node.rollup.done, late: node.rollup.late, latestChildDue: node.rollup.latestChildDue } : null,
        dependencies: deps,
        recentChanges: listChanges(db, { key }).slice(0, 8).map((c) => ({ field: c.field, from: c.oldValue, to: c.newValue, on: c.detectedAt.slice(0, 10) })),
        actionItems: ctx2.actions.slice(0, 10).map(actionView),
        updates: ctx2.updates.slice(0, 5).map((u) => ({ on: u.createdAt.slice(0, 10), progress: u.progress, body: u.body })),
        meetingNotes: ctx2.mentions.slice(0, 8),
        pendingLocalEdits: i.pendingFields,
      };
    }

    case "get_briefing": {
      const team = s(input.team);
      const f = teamFilter(m, team);
      if (!f) return { error: `Unknown team "${team}".` };
      const actions = listActionItems(db);
      const b = buildBrief(
        m,
        f,
        { actions, notes: listNotes(db), updates: listItemUpdates(db), programs: listProgramActions(db, m, actions) },
        { rag: "amber", subject: team || `the ${m.cfg.trackName} track` },
      );
      return {
        summary: b.summary,
        callouts: b.callouts.map((c) => ({ kind: c.kind, severity: c.severity, title: c.title, detail: c.body, link: c.href })),
      };
    }

    case "list_dependencies": {
      const f = teamFilter(m, s(input.team));
      if (!f) return { error: `Unknown team "${s(input.team)}".` };
      const deps = m.deps
        .filter((d) => !input.health || d.health === input.health)
        .filter((d) => !s(input.team) || matchesFilter(m, d.predecessor.key, f) || matchesFilter(m, d.successor.key, f))
        .slice(0, 40)
        .map((d) => ({
          predecessor: brief(d.predecessor, m),
          successor: brief(d.successor, m),
          direction: d.direction,
          health: d.health,
          slipDays: d.slipDays,
          reason: d.reason,
          page: depHref(d),
        }));
      return { dependencies: deps };
    }

    case "list_risks_decisions": {
      const f = teamFilter(m, s(input.team));
      if (!f) return { error: `Unknown team "${s(input.team)}".` };
      const updates = listItemUpdates(db);
      const items = m.issues
        .filter((i) => (input.kind ? i.level === input.kind : i.level === "risk" || i.level === "decision"))
        .filter((i) => i.statusCategory !== "done")
        .filter((i) => !s(input.team) || matchesFilter(m, i.key, f))
        .map((i) => {
          const last = updates.find((u) => u.key === i.key);
          return { ...brief(i, m), tier: i.tier, latestUpdate: last ? { on: last.createdAt.slice(0, 10), progress: last.progress, body: last.body } : null };
        });
      return { items };
    }

    case "list_action_items": {
      const team = s(input.team);
      const status = s(input.status) || "open";
      const q = normText(s(input.query)).trim();
      const actions = listActionItems(db)
        .filter((a) => a.kind === "team")
        .filter((a) => status === "all" || a.status === status)
        .filter((a) => !team || a.subTrack === team || a.platform === team)
        .filter((a) => !q || normText(a.text).includes(q))
        .slice(0, 40)
        .map(actionView);
      const asks = listProgramActions(db, m, listActionItems(db))
        .map((p) => ({
          title: p.title,
          jiraKey: p.jiraKey,
          due: p.dueDate,
          teams: p.assignments
            .filter((x) => !team || x.scope.name === team)
            .map((x) => ({ team: x.scope.name, status: x.status, owner: x.owner, due: x.dueDate })),
        }))
        .filter((p) => p.teams.length);
      return { actionItems: actions, programAsks: asks.slice(0, 20), today: m.today };
    }

    case "search_notes": {
      const words = normText(s(input.query)).trim().split(" ").filter((w) => w.length > 1);
      if (!words.length) return { results: [] };
      const out: { note: string; date: string | null; line: string }[] = [];
      for (const n of listNotes(db)) {
        for (const raw of n.body.split(/\r?\n/)) {
          const hay = normText(raw);
          if (words.every((w) => hay.includes(w))) out.push({ note: n.title, date: n.meetingDate, line: raw.trim().slice(0, 300) });
          if (out.length >= 25) break;
        }
      }
      return { results: out };
    }

    case "recent_changes": {
      const days = Math.min(90, Math.max(1, Number(input.days) || 14));
      const since = new Date(Date.parse(m.today) - days * 86_400_000).toISOString();
      const f = teamFilter(m, s(input.team));
      if (!f) return { error: `Unknown team "${s(input.team)}".` };
      const changes = listChanges(db, { sinceIso: since })
        .filter((c) => !s(input.team) || matchesFilter(m, c.key, f))
        .slice(0, 40)
        .map((c) => ({ key: c.key, summary: m.byKey.get(c.key)?.summary, field: c.field, from: c.oldValue, to: c.newValue, on: c.detectedAt.slice(0, 10) }));
      return { changes };
    }

    case "propose_changes":
      return proposeChanges(input, ctx);

    default:
      return { error: `Unknown tool ${name}.` };
  }
}

/** Validate proposed changes and keep the good ones; report problems back to the model so it can fix them. */
function proposeChanges(input: In, ctx: ToolContext) {
  const { db, m } = ctx;
  const accepted: ProposedChange[] = [];
  const problems: string[] = [];
  const actions = listActionItems(db);
  const changes = Array.isArray(input.changes) ? (input.changes as In[]) : [];
  changes.forEach((c, n) => {
    const where = `changes[${n}]`;
    const reason = s(c.reason) || "Reported in chat";
    const key = s(c.key).toUpperCase();
    const issue = key ? m.byKey.get(key) : undefined;
    switch (c.kind) {
      case "field": {
        const field = s(c.field) as "dueDate" | "startDate" | "status";
        const value = s(c.value);
        if (!issue) return problems.push(`${where}: unknown key "${key}".`);
        if (!["dueDate", "startDate", "status"].includes(field)) return problems.push(`${where}: field must be dueDate, startDate or status.`);
        if (field !== "status" && !ISO.test(value)) return problems.push(`${where}: ${field} must be YYYY-MM-DD.`);
        if (!value) return problems.push(`${where}: value is empty.`);
        const current = issue[field];
        if ((current ?? "") === value) return problems.push(`${where}: ${key} ${field} is already ${value}; nothing to change.`);
        return accepted.push({ kind: "field", key, field, value, current, reason });
      }
      case "comment":
        if (!issue) return problems.push(`${where}: unknown key "${key}".`);
        if (!s(c.body)) return problems.push(`${where}: comment body is empty.`);
        return accepted.push({ kind: "comment", key, body: s(c.body), reason });
      case "update": {
        if (!issue) return problems.push(`${where}: unknown key "${key}".`);
        const progress = s(c.progress) as UpdateProgress;
        if (!s(c.body) && !progress) return problems.push(`${where}: an update needs a body or a progress value.`);
        return accepted.push({ kind: "update", key, progress: progress || null, body: s(c.body), reason });
      }
      case "action": {
        const text = s(c.body);
        if (!text) return problems.push(`${where}: action text (body) is empty.`);
        const due = s(c.dueDate);
        if (due && !ISO.test(due)) return problems.push(`${where}: dueDate must be YYYY-MM-DD.`);
        const team = s(c.team);
        if (team && !m.subTracks.includes(team) && !m.platforms.includes(team)) return problems.push(`${where}: unknown team "${team}".`);
        const links = (Array.isArray(c.links) ? c.links : []).map((k) => s(k).toUpperCase()).filter((k) => m.byKey.has(k));
        return accepted.push({ kind: "action", text, owner: s(c.owner) || null, dueDate: due || null, team: team || null, links, reason });
      }
      case "actionDone": {
        const a = actions.find((x) => x.id === Number(c.id));
        if (!a) return problems.push(`${where}: no action item with id ${String(c.id)}.`);
        if (a.status === "done") return problems.push(`${where}: action ${a.id} is already done.`);
        return accepted.push({ kind: "actionDone", id: a.id, text: a.text, reason });
      }
      default:
        problems.push(`${where}: unknown kind.`);
    }
  });
  ctx.proposals.push(...accepted);
  return {
    shownToUser: accepted.length,
    problems,
    note: accepted.length
      ? "These are shown to the user as proposals. Nothing has changed yet; the user decides what to stage. Don't repeat the full list in your reply."
      : "Nothing was proposed. Fix the problems and call again if needed.",
  };
}
