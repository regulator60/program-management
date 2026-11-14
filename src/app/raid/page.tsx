import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import { Card, DateCell, KeyLink, PageHeader, StatusPill, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/lib/db";
import { isLate } from "@/lib/hierarchy";
import { loadModel, matchesFilter, parseFilter, type Model } from "@/lib/model";
import type { IssueView } from "@/lib/store";

export default function Page(props: PageProps<"/raid">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Raid searchParams={props.searchParams} />
    </Suspense>
  );
}

const TIER_HELP: Record<string, string> = {
  "1": "Program-level, multiple tracks",
  "2": "Multi-track",
  "3": "This track only",
  none: "Tier not set — check the tier label/field",
};

async function Raid({ searchParams }: { searchParams: PageProps<"/raid">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const show = sp.show === "all" ? "all" : "open";
  const m = loadModel(getDb());
  const pick = (level: "risk" | "decision") =>
    m.issues.filter(
      (i) => i.level === level && matchesFilter(m, i.key, f) && (show === "all" || i.statusCategory !== "done"),
    );

  return (
    <>
      <PageHeader
        title="Risks & decisions"
        subtitle="Tier 3 = your track only. Tiers 1 and 2 span multiple tracks."
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[{ name: "show", label: "Show", options: [{ value: "", label: "Open only" }, { value: "all", label: "Include closed" }] }]}
      />
      <div className="grid gap-6">
        <TierTable title="Risks" items={pick("risk")} m={m} />
        <TierTable title="Decisions" items={pick("decision")} m={m} />
      </div>
    </>
  );
}

function TierTable({ title, items, m }: { title: string; items: IssueView[]; m: Model }) {
  const tiers = ["1", "2", "3", "none"].map((t) => ({
    t,
    rows: items
      .filter((i) => (t === "none" ? i.tier == null : i.tier === Number(t)))
      .sort((a, b) => (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1),
  }));
  return (
    <Card title={`${title} (${items.length})`}>
      <Table>
        <thead>
          <tr>
            <Th>Key</Th>
            <Th>Summary</Th>
            <Th>Status</Th>
            <Th>Owner</Th>
            <Th>Sub-track</Th>
            <Th>Linked</Th>
            <Th>Due / need-by</Th>
          </tr>
        </thead>
        <tbody>
          {tiers.map(({ t, rows }) =>
            rows.length === 0 ? null : (
              <TierRows key={t} t={t} rows={rows} m={m} />
            ),
          )}
          {items.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-6 text-center text-muted">None.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  );
}

function TierRows({ t, rows, m }: { t: string; rows: IssueView[]; m: Model }) {
  return (
    <>
      <tr className="bg-zinc-50 dark:bg-zinc-900">
        <Td colSpan={7} className="text-xs font-semibold uppercase tracking-wide">
          {t === "none" ? "No tier" : `Tier ${t}`} <span className="font-normal normal-case text-muted">— {TIER_HELP[t]}</span>
        </Td>
      </tr>
      {rows.map((i) => {
        const linked = m.links
          .filter((l) => l.fromKey === i.key || l.toKey === i.key)
          .map((l) => (l.fromKey === i.key ? l.toKey : l.fromKey));
        return (
          <tr key={i.key}>
            <Td><KeyLink k={i.key} /></Td>
            <Td>{i.summary}</Td>
            <Td><StatusPill issue={i} /></Td>
            <Td className="text-xs">{i.assignee ?? "—"}</Td>
            <Td className="text-xs text-muted">{m.subTrackOf.get(i.key) ?? "—"}</Td>
            <Td className="text-xs">
              <span className="flex flex-wrap gap-1">
                {linked.map((k) => <KeyLink key={k} k={k} external={!m.byKey.get(k)?.inScope} />)}
              </span>
            </Td>
            <Td><DateCell date={i.dueDate} late={isLate(i, m.today)} pending={i.pendingFields.includes("dueDate")} /></Td>
          </tr>
        );
      })}
    </>
  );
}
