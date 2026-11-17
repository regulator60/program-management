import type { DatabaseSync } from "node:sqlite";
import { actionContext } from "../connectors";
import { addActionItem, addItemUpdate, stageEdit, updateActionItem } from "../store";
import type { ProposedChange } from "./tools";

type Row = Record<string, unknown>;

/**
 * Stage or dismiss proposals from one assistant message. Proposals are read
 * from the database (never from the browser), and each one is applied at most once.
 * Jira changes are only staged: they reach Jira when the user pushes them.
 */
export function applyProposals(db: DatabaseSync, messageId: number, picks: number[], intent: "stage" | "dismiss" = "stage") {
  const row = db.prepare("SELECT proposals, applied FROM assistant_messages WHERE id = ?").get(messageId) as Row | undefined;
  if (!row?.proposals) throw new Error("No proposals on that message.");
  const proposals = JSON.parse(String(row.proposals)) as ProposedChange[];
  const applied = new Set<number>(row.applied ? JSON.parse(String(row.applied)) : []);
  const todo = [...new Set(picks)].filter((i) => Number.isInteger(i) && i >= 0 && i < proposals.length && !applied.has(i));
  const counts = { staged: 0, actions: 0, updates: 0, done: 0, dismissed: 0 };
  const ctx = intent === "stage" ? actionContext(db) : null;

  db.exec("BEGIN");
  try {
    for (const i of todo) {
      const p = proposals[i];
      if (intent === "dismiss") {
        counts.dismissed++;
      } else if (p.kind === "field") {
        stageEdit(db, p.key, p.field, p.value);
        counts.staged++;
      } else if (p.kind === "comment") {
        stageEdit(db, p.key, "comment", p.body);
        counts.staged++;
      } else if (p.kind === "update") {
        addItemUpdate(db, { key: p.key, body: p.body, progress: p.progress, scope: "assistant" });
        counts.updates++;
      } else if (p.kind === "action") {
        const isPlatform = !!p.team && ctx!.isSubTrack(p.team) === false;
        const scope = ctx!.scopeFor(p.text, { subTrack: isPlatform ? null : p.team, platform: isPlatform ? p.team : null });
        addActionItem(db, {
          text: p.text,
          owner: p.owner,
          dueDate: p.dueDate,
          subTrack: scope.subTrack,
          platform: scope.platform,
          links: [...new Set([...p.links, ...scope.links])],
        });
        counts.actions++;
      } else if (p.kind === "actionDone") {
        updateActionItem(db, p.id, { status: "done" });
        counts.done++;
      }
      applied.add(i);
    }
    db.prepare("UPDATE assistant_messages SET applied = ? WHERE id = ?").run(JSON.stringify([...applied].sort((a, b) => a - b)), messageId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ...counts, applied: [...applied] };
}
