import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

/** Renders docs/JIRA_IMPORT.md (static at build time) with a tiny markdown subset. */
export default function Page() {
  const md = readFileSync(join(process.cwd(), "docs", "JIRA_IMPORT.md"), "utf8");
  return <article className="max-w-3xl space-y-3 text-sm leading-6">{render(md)}</article>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) => {
    if (p.startsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith("`")) return <code key={i} className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.length > 2) return <i key={i}>{p.slice(1, -1)}</i>;
    return p;
  });
}

function render(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split("\n");
  let list: { ordered: boolean; items: { text: string; sub: string[] }[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    out.push(
      <L key={out.length} className={(list.ordered ? "list-decimal" : "list-disc") + " space-y-1 pl-6"}>
        {list.items.map((it, i) => (
          <li key={i}>
            {inline(it.text)}
            {it.sub.length > 0 && <ul className="list-disc pl-5">{it.sub.map((s, j) => <li key={j}>{inline(s)}</li>)}</ul>}
          </li>
        ))}
      </L>,
    );
    list = null;
  };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(#{1,3}) (.*)/))) {
      flush();
      const cls = m[1].length === 1 ? "text-2xl font-semibold" : "mt-6 text-lg font-semibold";
      out.push(<div key={out.length} className={cls}>{inline(m[2])}</div>);
    } else if ((m = line.match(/^\s{2,}- (.*)/)) && list) {
      list.items[list.items.length - 1]?.sub.push(m[1]);
    } else if ((m = line.match(/^(\d+)\. (.*)/)) || (m = line.match(/^()- (.*)/))) {
      const ordered = m[1] !== "";
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push({ text: m[2], sub: [] });
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flush();
  return out;
}
