import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import { Card, DateCell, Empty, HealthBadge, KeyLink, LevelTag, PageHeader, StatusPill, Table, Td, Th, fmtDate } from "@/components/ui";
import { getDb } from "@/lib/db";
import { HEALTH_ORDER, needByDate, type Dependency } from "@/lib/dependencies";
import { loadModel, matchesFilter, parseFilter } from "@/lib/model";
import type { IssueView } from "@/lib/store";

export default function Page(props: PageProps<"/dependencies">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Deps searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Deps({ searchParams }: { searchParams: PageProps<"/dependencies">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const dir = typeof sp.dir === "string" ? sp.dir : "";
  const health = typeof sp.health === "string" ? sp.health : "";
  const key = typeof sp.key === "string" ? sp.key : "";
  const m = loadModel(getDb());

  const deps = m.deps.filter((d) => {
    const mine = d.direction === "outgoing" ? d.predecessor : d.successor;
    if (!matchesFilter(m, mine.key, f)) return false;
    if (dir && d.direction !== dir) return false;
    if (health === "issues" && !["conflict", "overdue", "tight", "unknown"].includes(d.health)) return false;
    if (health && health !== "issues" && d.health !== health) return false;
    if (key && d.predecessor.key !== key && d.successor.key !== key) return false;
    return true;
  });
  const changed = deps.filter((d) => d.recentChanges.length > 0);
  const counts = Object.fromEntries(HEALTH_ORDER.map((h) => [h, deps.filter((d) => d.health === h).length]));

  return (
    <>
      <PageHeader
        title="Dependencies"
        subtitle={
          <>
            Every blocks / depends-on link touching your items. A dependency is a <b>conflict</b> when the predecessor is
            due after the successor needs it (its start date, or due date if no start). <b>Tight</b> = under{" "}
            {m.cfg.analysis.bufferDays} days of buffer.
            {key && <> Showing links for <b>{key}</b>.</>}
          </>
        }
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[
          {
            name: "dir",
            label: "Direction",
            options: [
              { value: "", label: "All" },
              { value: "incoming", label: "I depend on others" },
              { value: "outgoing", label: "Others depend on me" },
              { value: "internal", label: "Within my track" },
            ],
          },
          {
            name: "health",
            label: "Health",
            options: [
              { value: "", label: "All" },
              { value: "issues", label: "Needs attention" },
              ...HEALTH_ORDER.map((h) => ({ value: h, label: h })),
            ],
          },
        ]}
      />
      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        {HEALTH_ORDER.map((h) => (
          <span key={h} className="flex items-center gap-1.5">
            <HealthBadge health={h} /> <span className="tabular-nums">{counts[h]}</span>
          </span>
        ))}
      </div>

      {changed.length > 0 && (
        <Card title={`Changed in the last ${m.cfg.analysis.recentChangeDays} days`} className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Item that changed</Th>
                <Th>Change</Th>
                <Th>Detected</Th>
                <Th>Affects</Th>
                <Th>Now</Th>
              </tr>
            </thead>
            <tbody>
              {changed.flatMap((d) =>
                d.recentChanges.map((c) => {
                  const mine = d.direction === "outgoing" ? d.predecessor : d.successor;
                  return (
                    <tr key={`${d.predecessor.key}-${d.successor.key}-${c.id}`}>
                      <Td>
                        <KeyLink k={c.key} external={!m.byKey.get(c.key)?.inScope} />{" "}
                        <span className="text-xs">{m.byKey.get(c.key)?.summary}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {label(c.field)}: {c.field.endsWith("Date") ? fmtDate(c.oldValue) : c.oldValue ?? "—"} →{" "}
                        <b>{c.field.endsWith("Date") ? fmtDate(c.newValue) : c.newValue ?? "—"}</b>
                      </Td>
                      <Td className="text-xs text-muted">{fmtDate(c.detectedAt.slice(0, 10))}</Td>
                      <Td><KeyLink k={mine.key} /></Td>
                      <Td><HealthBadge health={d.health} /></Td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {deps.length === 0 ? (
        <Empty>No dependencies match.</Empty>
      ) : (
        <Card title="All dependencies">
          <Table>
            <thead>
              <tr>
                <Th>Health</Th>
                <Th>Predecessor (must finish first)</Th>
                <Th>Due</Th>
                <Th></Th>
                <Th>Successor (needs it)</Th>
                <Th>Needs by</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {deps.map((d) => (
                <Row key={`${d.predecessor.key}-${d.successor.key}-${d.link.typeName}`} d={d} today={m.today} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function label(field: string) {
  return field === "dueDate" ? "Due" : field === "startDate" ? "Start" : field[0].toUpperCase() + field.slice(1);
}

function Side({ i }: { i: IssueView }) {
  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-1.5">
        <LevelTag level={i.level} />
        <KeyLink k={i.key} external={!i.inScope} />
        <StatusPill issue={i} />
        {!i.inScope && <span className="text-[10px] uppercase text-muted">other track</span>}
      </div>
      <div className="text-xs">{i.summary}</div>
    </div>
  );
}

function Row({ d, today }: { d: Dependency; today: string }) {
  const changedKeys = new Set(d.recentChanges.map((c) => c.key));
  return (
    <tr>
      <Td><HealthBadge health={d.health} /></Td>
      <Td><Side i={d.predecessor} /></Td>
      <Td>
        <DateCell date={d.predecessor.dueDate} late={!!d.predecessor.dueDate && d.predecessor.dueDate < today && d.predecessor.statusCategory !== "done"} />
        {changedKeys.has(d.predecessor.key) && <div className="text-[10px] font-semibold uppercase text-fuchsia-600">changed</div>}
      </Td>
      <Td className="whitespace-nowrap text-xs text-muted">{d.link.outward} →</Td>
      <Td><Side i={d.successor} /></Td>
      <Td>
        <DateCell date={needByDate(d.successor)} />
        {changedKeys.has(d.successor.key) && <div className="text-[10px] font-semibold uppercase text-fuchsia-600">changed</div>}
      </Td>
      <Td className="text-xs text-muted">{d.reason}</Td>
    </tr>
  );
}
