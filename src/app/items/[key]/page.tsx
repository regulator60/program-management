import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { discardEditAction, stageEditsAction } from "@/app/actions";
import { Button, Card, DateCell, Empty, HealthBadge, KeyLink, LevelTag, PageHeader, StatusPill, Table, Td, Th, fmtDate, inputCls } from "@/components/ui";
import { getDb } from "@/lib/db";
import { childMap, isLate } from "@/lib/hierarchy";
import { loadModel } from "@/lib/model";
import { listChanges, listItemUpdates, listPendingEdits } from "@/lib/store";
import { LastUpdate, UpdateComposer } from "@/components/updates";
import { LEVEL_LABEL } from "@/lib/types";

export default function Page(props: PageProps<"/items/[key]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Item params={props.params} />
    </Suspense>
  );
}

async function Item({ params }: { params: PageProps<"/items/[key]">["params"] }) {
  await connection();
  const key = decodeURIComponent((await params).key);
  const db = getDb();
  const m = loadModel(db);
  const i = m.byKey.get(key);
  if (!i) {
    return (
      <>
        <PageHeader title={key} />
        <Empty>
          {key} isn&rsquo;t in the local database. It may be linked from another issue but not synced yet.
        </Empty>
      </>
    );
  }
  const { children, byKey } = childMap(m.issues, m.links, m.cfg);
  const parents = [...children.entries()].filter(([, set]) => set.has(key)).map(([p]) => byKey.get(p)!);
  const kids = [...(children.get(key) ?? [])].map((k) => byKey.get(k)!).sort((a, b) => (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1);
  const deps = m.deps.filter((d) => d.predecessor.key === key || d.successor.key === key);
  const otherLinks = m.links.filter(
    (l) => (l.fromKey === key || l.toKey === key) && !deps.some((d) => d.link === l) &&
      !(children.get(l.fromKey)?.has(l.toKey)),
  );
  const history = listChanges(db, { key });
  const updates = listItemUpdates(db, key);
  const pending = listPendingEdits(db, { unpushedOnly: true }).filter((e) => e.key === key);
  const jiraUrl = m.cfg.jira.baseUrl ? `${m.cfg.jira.baseUrl.replace(/\/+$/, "")}/browse/${key}` : null;

  return (
    <>
      <PageHeader
        title={`${key} · ${i.summary}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <LevelTag level={i.level} /> {LEVEL_LABEL[i.level]} ({i.issueType}) <StatusPill issue={i} />
            {!i.inScope && <span className="text-xs uppercase">other track</span>}
            {jiraUrl && <a href={jiraUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open in Jira ↗</a>}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-6">
          <Card title="Details">
            <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted">Assignee</dt><dd>{i.assignee ?? "—"}</dd>
              <dt className="text-muted">Start</dt><dd><DateCell date={i.startDate} pending={i.pendingFields.includes("startDate")} /></dd>
              <dt className="text-muted">Due</dt><dd><DateCell date={i.dueDate} late={isLate(i, m.today)} pending={i.pendingFields.includes("dueDate")} /></dd>
              <dt className="text-muted">Sub-track</dt><dd>{m.subTrackOf.get(key) ?? "—"}{!i.subTrack && m.subTrackOf.get(key) && <span className="text-xs text-muted"> (inherited)</span>}</dd>
              <dt className="text-muted">Platforms</dt><dd>{(m.platformsOf.get(key) ?? []).join(", ") || "—"}</dd>
              {i.tier != null && (<><dt className="text-muted">Tier</dt><dd>Tier {i.tier}</dd></>)}
              <dt className="text-muted">Labels</dt><dd className="font-mono text-xs">{i.labels.join(", ") || "—"}</dd>
              <dt className="text-muted">Last synced</dt><dd className="text-xs">{i.syncedAt.slice(0, 16).replace("T", " ")} ({i.source})</dd>
            </dl>
            {i.description && <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{i.description}</pre>}
          </Card>

          <Card title="Hierarchy">
            <div className="text-sm">
              <div className="mb-2"><span className="text-muted">Parent: </span>{parents.length ? parents.map((p) => <span key={p.key} className="mr-3"><KeyLink k={p.key} /> {p.summary}</span>) : "—"}</div>
              {kids.length > 0 && (
                <Table>
                  <thead><tr><Th></Th><Th>Child</Th><Th>Status</Th><Th>Due</Th></tr></thead>
                  <tbody>
                    {kids.map((k) => (
                      <tr key={k.key}>
                        <Td><LevelTag level={k.level} /></Td>
                        <Td><KeyLink k={k.key} external={!k.inScope} /> {k.summary}</Td>
                        <Td><StatusPill issue={k} /></Td>
                        <Td>
                          <DateCell date={k.dueDate} late={isLate(k, m.today)} />
                          {i.dueDate && k.dueDate && k.dueDate > i.dueDate && <span className="ml-1 text-xs text-critical-ink">after parent</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>

          <Card title="Dependencies">
            {deps.length === 0 ? (
              <p className="text-sm text-muted">No blocking/dependency links.</p>
            ) : (
              <Table>
                <tbody>
                  {deps.map((d) => {
                    const other = d.predecessor.key === key ? d.successor : d.predecessor;
                    return (
                      <tr key={`${d.predecessor.key}-${d.successor.key}`}>
                        <Td><HealthBadge health={d.health} /></Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{d.predecessor.key === key ? "needed by" : "waits on"}</Td>
                        <Td><KeyLink k={other.key} external={!other.inScope} /> {other.summary}</Td>
                        <Td className="text-xs text-muted">{d.reason}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {otherLinks.length > 0 && (
              <div className="mt-3 text-xs text-muted">
                Other links:{" "}
                {otherLinks.map((l) => {
                  const out = l.fromKey === key;
                  const other = out ? l.toKey : l.fromKey;
                  return <span key={`${l.fromKey}${l.toKey}${l.typeName}`} className="mr-3">{out ? l.outward : l.inward} <KeyLink k={other} /></span>;
                })}
              </div>
            )}
          </Card>

          <Card title="Updates" subtitle="Status notes captured in S0 calls or here, newest first">
            {updates.length === 0 ? (
              <p className="text-sm text-muted">No updates yet.</p>
            ) : (
              <ul className="grid gap-2">
                {updates.map((u) => (
                  <li key={u.id}>
                    <LastUpdate u={u} today={m.today} className="mt-0" />
                  </li>
                ))}
              </ul>
            )}
            <UpdateComposer issueKey={key} back={`/items/${encodeURIComponent(key)}`} defaultOpen={updates.length === 0} />
          </Card>

          <Card title="Change history (detected between syncs)">
            {history.length === 0 ? (
              <p className="text-sm text-muted">No changes recorded yet.</p>
            ) : (
              <Table>
                <tbody>
                  {history.map((c) => (
                    <tr key={c.id}>
                      <Td className="text-xs text-muted">{fmtDate(c.detectedAt.slice(0, 10))}</Td>
                      <Td className="text-xs">{c.field}</Td>
                      <Td className="text-xs">{c.oldValue ?? "—"} → <b>{c.newValue ?? "—"}</b></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card title="Edit (staged locally)">
            <form action={stageEditsAction} className="grid gap-2 text-sm">
              <input type="hidden" name="key" value={key} />
              <label className="grid gap-1"><span className="text-xs text-muted">Summary</span><input name="summary" defaultValue={i.summary} className={inputCls} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1"><span className="text-xs text-muted">Start date</span><input type="date" name="startDate" defaultValue={i.startDate ?? ""} className={inputCls} /></label>
                <label className="grid gap-1"><span className="text-xs text-muted">Due date</span><input type="date" name="dueDate" defaultValue={i.dueDate ?? ""} className={inputCls} /></label>
              </div>
              <label className="grid gap-1"><span className="text-xs text-muted">Status (must match a Jira workflow status)</span><input name="status" defaultValue={i.status} className={inputCls} /></label>
              <label className="grid gap-1"><span className="text-xs text-muted">Assignee (Jira username for pushes)</span><input name="assignee" defaultValue={i.assignee ?? ""} className={inputCls} /></label>
              <label className="grid gap-1"><span className="text-xs text-muted">Labels (space or comma separated)</span><input name="labels" defaultValue={i.labels.join(" ")} className={inputCls + " font-mono text-xs"} /></label>
              <Button type="submit">Stage changes</Button>
              <p className="text-xs text-muted">
                Nothing is sent to Jira until you push from <Link href="/sync" className="text-accent underline">Data &amp; Jira sync</Link>.
              </p>
            </form>
          </Card>
          {pending.length > 0 && (
            <Card title="Pending for this item">
              <ul className="space-y-1 text-sm">
                {pending.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs"><b>{e.field}</b>: {e.oldValue ?? "—"} → {e.newValue ?? "—"}</span>
                    <form action={discardEditAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="back" value={`/items/${encodeURIComponent(key)}`} />
                      <Button variant="secondary" type="submit">Undo</Button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
