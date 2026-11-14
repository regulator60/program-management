import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  clearDataAction,
  discardEditAction,
  importJiraFileAction,
  importSheetAction,
  markExportedAction,
  pushViaRestAction,
  seedDemoAction,
  syncJiraAction,
} from "@/app/actions";
import { Button, Card, KeyLink, PageHeader, Table, Td, Th, inputCls } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { missingLinkedKeys } from "@/lib/connectors";
import { getDb } from "@/lib/db";
import { jiraAuthHeader } from "@/lib/jira/client";
import { listPendingEdits, recentSyncs } from "@/lib/store";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Sync />
    </Suspense>
  );
}

async function Sync() {
  await connection();
  const db = getDb();
  const cfg = getConfig(db);
  const hasCreds = !!jiraAuthHeader();
  const canSync = !!cfg.jira.baseUrl && hasCreds;
  const pending = listPendingEdits(db, { unpushedOnly: true });
  const missing = missingLinkedKeys(db);
  const logs = recentSyncs(db, 12);
  const issueCount = (db.prepare("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n;

  return (
    <>
      <PageHeader title="Data & Jira sync" subtitle={`${issueCount} issues stored locally.`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="1 · Pull from Jira (REST)">
          <dl className="mb-3 grid grid-cols-[120px_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Base URL</dt>
            <dd>{cfg.jira.baseUrl || <span className="text-amber-600">not set — <Link href="/settings" className="underline">Settings</Link></span>}</dd>
            <dt className="text-muted">Credentials</dt>
            <dd>{hasCreds ? "found in environment" : <span className="text-amber-600">set JIRA_PAT in .env.local</span>}</dd>
            <dt className="text-muted">Scope JQL</dt>
            <dd className="font-mono text-xs">{cfg.jira.scopeJql}</dd>
            <dt className="text-muted">Intake JQL</dt>
            <dd className="font-mono text-xs">{cfg.jira.intakeJql || "—"}</dd>
          </dl>
          <form action={syncJiraAction}>
            <Button type="submit" disabled={!canSync}>Sync now</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Pulls your track, the intake board, and one hop of linked issues from other tracks. Date and status changes
            since the last pull are recorded so you can see which dependencies moved.
          </p>
        </Card>

        <Card title="2 · Push changes to Jira">
          {pending.length === 0 ? (
            <p className="text-sm text-muted">No staged edits. Edit an item (click any key) to stage a change.</p>
          ) : (
            <>
              <Table>
                <thead><tr><Th>Key</Th><Th>Field</Th><Th>Jira has</Th><Th>New</Th><Th></Th></tr></thead>
                <tbody>
                  {pending.map((e) => (
                    <tr key={e.id}>
                      <Td><KeyLink k={e.key} /></Td>
                      <Td className="text-xs">{e.field}</Td>
                      <Td className="text-xs text-muted">{e.oldValue ?? "—"}</Td>
                      <Td className="text-xs font-medium">{e.newValue ?? "—"}</Td>
                      <Td>
                        <form action={discardEditAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <button className="text-xs text-red-600 hover:underline">discard</button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="rounded-md border border-line p-3">
                  <div className="mb-1 font-medium">Option A — CSV import (recommended for finicky Jira)</div>
                  <ol className="mb-2 list-decimal pl-5 text-xs text-muted">
                    <li>Download the CSV.</li>
                    <li>Import it in Jira: <i>Administration → System → External System Import → CSV</i>, map <b>Issue Key</b>, date format <code>yyyy-MM-dd</code>.</li>
                    <li>When Jira says the import succeeded, click &ldquo;Mark as imported&rdquo;, then sync to confirm.</li>
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <a href="/api/export/updates" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Download update CSV</a>
                    <form action={markExportedAction}>
                      <input type="hidden" name="ids" value={pending.map((e) => e.id).join(",")} />
                      <Button variant="secondary" type="submit">Mark as imported</Button>
                    </form>
                    <Link href="/docs/jira-import" className="self-center text-xs text-accent hover:underline">Full instructions</Link>
                  </div>
                </div>
                <div className="rounded-md border border-line p-3">
                  <div className="mb-1 font-medium">Option B — Push via REST</div>
                  <p className="mb-2 text-xs text-muted">
                    One issue at a time, {cfg.jira.writeDelayMs} ms apart. Status changes use workflow transitions.
                    Failed issues stay pending.
                  </p>
                  <form action={pushViaRestAction}>
                    <Button variant="secondary" type="submit" disabled={!canSync}>Push {pending.length} edit(s) via REST</Button>
                  </form>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card title="3 · Import a Jira export file">
          <form action={importJiraFileAction} className="grid gap-2 text-sm">
            <input type="file" name="file" accept=".json,.csv" className={inputCls} required />
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1"><input type="radio" name="scope" value="mine" defaultChecked /> My track (in scope)</label>
              <label className="flex items-center gap-1"><input type="radio" name="scope" value="external" /> Other tracks (dependencies only)</label>
            </div>
            <Button type="submit">Import</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Use when the app can&rsquo;t reach Jira. <b>CSV:</b> issue search → Export → CSV (All fields). <b>JSON:</b> open{" "}
            <code className="break-all">/rest/api/2/search?jql=…&amp;maxResults=1000&amp;fields=*all</code> in your browser and save the page.
          </p>
          {missing.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
                {missing.length} linked issue(s) aren&rsquo;t loaded yet — JQL to export them
              </summary>
              <textarea readOnly rows={3} className={inputCls + " mt-2 font-mono text-xs"} value={`key in (${missing.join(", ")})`} />
            </details>
          )}
        </Card>

        <Card title="4 · Google Sheets">
          <form action={importSheetAction} className="grid gap-2 text-sm">
            <input name="url" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" className={inputCls} />
            <div className="text-center text-xs text-muted">or</div>
            <input type="file" name="file" accept=".csv" className={inputCls} />
            <select name="target" className={inputCls} defaultValue="action_items">
              <option value="action_items">Rows are action items (Action, Owner, Due, Status, Sub-track, Jira)</option>
              <option value="subtrack_map">Rows map Jira keys to sub-track / platform (Key, Sub-track, Platform)</option>
            </select>
            <Button type="submit">Import sheet</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            The URL works if the sheet is shared &ldquo;anyone with the link&rdquo; or published. For private sheets: File → Download → CSV, then upload.
            Sub-track mappings are overwritten by the next Jira sync; re-import afterwards.
          </p>
        </Card>

        <Card title="Demo data">
          <p className="mb-3 text-sm text-muted">Loads a fictional track so you can try every screen. Replaces local issues, notes and action items.</p>
          <div className="flex gap-2">
            <form action={seedDemoAction}><Button type="submit">Load demo data</Button></form>
            <form action={clearDataAction}><Button variant="danger" type="submit">Clear all local data</Button></form>
          </div>
        </Card>

        <Card title="Recent activity">
          {logs.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {logs.map((l) => (
                <li key={l.id} className={l.ok ? "" : "text-red-600"}>
                  <span className="text-muted">{l.finished_at?.slice(0, 16).replace("T", " ")}</span> <b>{l.source}</b> {l.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
