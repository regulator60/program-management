import { ArrowUpRight, CheckCircle2, LifeBuoy, Siren, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, SeverityIcon } from "@/components/ui";
import type { Brief, Callout, CalloutKind } from "@/lib/brief";

const COLUMNS: { kind: CalloutKind; title: string; icon: LucideIcon; empty: string; hint: string }[] = [
  { kind: "attention", title: "Needs attention", icon: Siren, empty: "Nothing is threatening the plan.", hint: "What threatens the plan, and why" },
  { kind: "help", title: "Needs help", icon: LifeBuoy, empty: "Nothing is stuck.", hint: "Stuck, unowned or overdue: someone needs to step in" },
  { kind: "progress", title: "Moving forward", icon: CheckCircle2, empty: "No progress recorded in the last two weeks.", hint: "Completed, pulled in, or reported as moving" },
];

function Item({ c }: { c: Callout }) {
  return (
    <li>
      <Link href={c.href} className="group block rounded-lg px-3 py-2.5 transition hover:bg-panel-2">
        <div className="flex items-start gap-2">
          <SeverityIcon severity={c.severity} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug text-fg">{c.title}</div>
            {c.body.map((b, i) => (
              <p key={i} className="mt-1 text-[13px] leading-snug text-ink-2">
                {b}
              </p>
            ))}
          </div>
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

/** The briefing call-outs, in three columns. Shows the top items per column; the rest expand. */
export function Briefing({ brief, perColumn = 4, title = "Briefing" }: { brief: Brief; perColumn?: number; title?: string }) {
  return (
    <Card title={title} subtitle="Generated from Jira dates and links, action items, S0 updates and meeting notes" flush>
      <div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {COLUMNS.map((col) => {
          const items = brief.callouts.filter((c) => c.kind === col.kind);
          const top = items.slice(0, perColumn);
          const rest = items.slice(perColumn);
          return (
            <section key={col.kind} className="min-w-0 p-3" aria-label={col.title}>
              <div className="flex items-center gap-2 px-3 pb-1 pt-1">
                <col.icon className="h-4 w-4 text-muted" aria-hidden />
                <h3 className="text-sm font-semibold text-fg">{col.title}</h3>
                <span className="tabular ml-auto rounded-full bg-panel-2 px-2 text-xs font-medium text-ink-2">{items.length}</span>
              </div>
              <p className="px-3 pb-2 text-xs text-muted">{col.hint}</p>
              {items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">{col.empty}</p>
              ) : (
                <ul className="grid gap-0.5">
                  {top.map((c) => (
                    <Item key={c.id} c={c} />
                  ))}
                </ul>
              )}
              {rest.length > 0 && (
                <details>
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-accent">Show {rest.length} more</summary>
                  <ul className="grid gap-0.5">
                    {rest.map((c) => (
                      <Item key={c.id} c={c} />
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
