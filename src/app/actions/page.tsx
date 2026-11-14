import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { addActionItemAction, deleteActionItemAction, updateActionItemAction } from "@/app/actions";
import { Button, Card, DateCell, KeyLink, PageHeader, StatusPill, Table, Td, Th, inputCls } from "@/components/ui";
import { getDb } from "@/lib/db";
import { isLate } from "@/lib/hierarchy";
import { loadModel } from "@/lib/model";
import { listActionItems, listNotes } from "@/lib/store";

export default function Page(props: PageProps<"/actions">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Actions searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Actions({ searchParams }: { searchParams: PageProps<"/actions">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const showDone = sp.show === "all";
  const db = getDb();
  const m = loadModel(db);
  const intake = m.issues
    .filter((i) => i.isIntake && (showDone || i.statusCategory !== "done"))
    .sort((a, b) => (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1);
  const local = listActionItems(db).filter((a) => showDone || a.status === "open");
  const notes = new Map(listNotes(db).map((n) => [n.id, n]));
  const unsynced = local.filter((a) => a.status === "open" && !a.jiraKey).length;

  return (
    <>
      <PageHeader
        title="Action items"
        subtitle={`Program action items from the Jira intake board (label "${m.cfg.labels.intake}") plus items captured from notes.`}
        actions={
          <>
            <Link href={showDone ? "/actions" : "/actions?show=all"} className="text-sm text-accent hover:underline">
              {showDone ? "Hide done" : "Show done"}
            </Link>
            {unsynced > 0 && (
              <a href="/api/export/action-items" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                Export {unsynced} for Jira import (CSV)
              </a>
            )}
          </>
        }
      />

      <Card title={`Intake board (${intake.length})`} className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>Key</Th>
              <Th>Action</Th>
              <Th>Owner</Th>
              <Th>Status</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody>
            {intake.map((i) => (
              <tr key={i.key}>
                <Td><KeyLink k={i.key} /></Td>
                <Td>{i.summary}</Td>
                <Td className="text-xs">{i.assignee ?? "—"}</Td>
                <Td><StatusPill issue={i} /></Td>
                <Td><DateCell date={i.dueDate} late={isLate(i, m.today)} pending={i.pendingFields.includes("dueDate")} /></Td>
              </tr>
            ))}
            {intake.length === 0 && (
              <tr><Td colSpan={5} className="py-4 text-center text-muted">No intake items. Set the intake JQL in Settings and sync.</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card title={`From notes & manual (${local.length})`}>
        <form action={addActionItemAction} className="mb-4 grid gap-2 md:grid-cols-[1fr_160px_150px_160px_auto]">
          <input name="text" placeholder="New action item…" className={inputCls} required />
          <input name="owner" placeholder="Owner" className={inputCls} />
          <input name="dueDate" type="date" className={inputCls} />
          <select name="subTrack" className={inputCls} defaultValue="">
            <option value="">Sub-track…</option>
            {m.subTracks.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Button type="submit">Add</Button>
        </form>
        <Table>
          <thead>
            <tr>
              <Th></Th>
              <Th>Action</Th>
              <Th>Owner</Th>
              <Th>Due</Th>
              <Th>Jira key</Th>
              <Th>Source</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {local.map((a) => {
              const late = a.status === "open" && !!a.dueDate && a.dueDate < m.today;
              const formId = `ai-${a.id}`;
              return (
                <tr key={a.id} className={a.status === "done" ? "opacity-60" : ""}>
                  <Td>
                    <form action={updateActionItemAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="status" value={a.status === "done" ? "open" : "done"} />
                      <button title={a.status === "done" ? "Reopen" : "Mark done"} className="h-4 w-4 rounded border border-line text-[10px] leading-none">
                        {a.status === "done" ? "✓" : ""}
                      </button>
                    </form>
                  </Td>
                  <Td className={a.status === "done" ? "line-through" : ""}>
                    {a.text}
                    {a.subTrack && <div className="text-xs text-muted">{a.subTrack}</div>}
                  </Td>
                  <Td><input form={formId} name="owner" defaultValue={a.owner ?? ""} className={inputCls + " w-32"} /></Td>
                  <Td>
                    <input form={formId} name="dueDate" type="date" defaultValue={a.dueDate ?? ""} className={inputCls + " w-36" + (late ? " border-red-500 text-red-600" : "")} />
                  </Td>
                  <Td>
                    <input form={formId} name="jiraKey" defaultValue={a.jiraKey ?? ""} placeholder="BIGP-123" className={inputCls + " w-28 font-mono"} />
                  </Td>
                  <Td className="text-xs text-muted">
                    {a.noteId && notes.get(a.noteId) ? (
                      <Link href={`/notes#note-${a.noteId}`} className="hover:underline">{notes.get(a.noteId)!.title}</Link>
                    ) : (
                      "manual"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <form id={formId} action={updateActionItemAction} className="inline">
                      <input type="hidden" name="id" value={a.id} />
                      <Button variant="secondary" type="submit">Save</Button>
                    </form>{" "}
                    <form action={deleteActionItemAction} className="inline">
                      <input type="hidden" name="id" value={a.id} />
                      <Button variant="danger" type="submit" title="Delete">✕</Button>
                    </form>
                  </Td>
                </tr>
              );
            })}
            {local.length === 0 && (
              <tr><Td colSpan={7} className="py-4 text-center text-muted">Nothing here. Add one above or paste meeting notes on the Notes page.</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
