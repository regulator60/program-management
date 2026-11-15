import type { DatabaseSync } from "node:sqlite";
import type { Model } from "./model";
import { listActionItems, listAssignments } from "./store";
import type { ActionItem, ProgramAssignment, Scope } from "./types";

/** A high-level ask from the program, with each assigned team's part. */
export type ProgramAction = {
  /** "jira:KEY" or "local:ID" */
  parent: string;
  jiraKey: string | null;
  localId: number | null;
  title: string;
  owner: string | null;
  dueDate: string | null;
  /** The ask itself (Jira status, or local status). */
  closed: boolean;
  statusLabel: string;
  assignments: ProgramAssignment[];
  done: number;
  total: number;
  /** Every assigned team finished, but the ask itself is still open (e.g. in Jira). */
  readyToClose: boolean;
  late: boolean;
};

export function listProgramActions(db: DatabaseSync, m: Model, actions: ActionItem[] = listActionItems(db)): ProgramAction[] {
  const byParent = new Map<string, ProgramAssignment[]>();
  for (const a of listAssignments(db)) byParent.set(a.parent, [...(byParent.get(a.parent) ?? []), a]);

  const build = (p: Omit<ProgramAction, "assignments" | "done" | "total" | "readyToClose" | "late">): ProgramAction => {
    const assignments = byParent.get(p.parent) ?? [];
    const done = assignments.filter((a) => a.status === "done").length;
    return {
      ...p,
      assignments,
      done,
      total: assignments.length,
      readyToClose: !p.closed && assignments.length > 0 && done === assignments.length,
      late: !p.closed && !!p.dueDate && p.dueDate < m.today && done < Math.max(assignments.length, 1),
    };
  };

  const fromJira = m.issues
    .filter((i) => i.isIntake)
    .map((i) =>
      build({
        parent: `jira:${i.key}`,
        jiraKey: i.key,
        localId: null,
        title: i.summary,
        owner: i.assignee,
        dueDate: i.dueDate,
        closed: i.statusCategory === "done",
        statusLabel: i.status,
      }),
    );
  const local = actions
    .filter((a) => a.kind === "program")
    .map((a) =>
      build({
        parent: `local:${a.id}`,
        jiraKey: a.jiraKey,
        localId: a.id,
        title: a.text,
        owner: a.owner,
        dueDate: a.dueDate,
        closed: a.status === "done",
        statusLabel: a.status === "done" ? "Done" : "Open",
      }),
    );
  return [...fromJira, ...local].sort(
    (a, b) => Number(a.closed) - Number(b.closed) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );
}

/** Every team that can own work: all sub-tracks, then all platforms. */
export function allScopes(m: Model): Scope[] {
  return [
    ...m.subTracks.map((name) => ({ kind: "subtrack" as const, name })),
    ...m.platforms.map((name) => ({ kind: "platform" as const, name })),
  ];
}

/** Does a team action item belong to this scope (directly, or via the Jira items it's linked to)? */
export function actionInScope(a: ActionItem, scope: Scope, m: Model) {
  if (scope.kind === "subtrack" && a.subTrack === scope.name) return true;
  if (scope.kind === "platform" && a.platform === scope.name) return true;
  if (scope.kind === "subtrack" && a.subTrack) return false;
  if (scope.kind === "platform" && a.platform) return false;
  return a.links.some((k) =>
    scope.kind === "subtrack" ? m.subTrackOf.get(k) === scope.name : (m.platformsOf.get(k) ?? []).includes(scope.name),
  );
}

