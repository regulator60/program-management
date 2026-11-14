import { toIsoDate } from "./jira/classify";

export type ExtractedAction = {
  text: string;
  owner: string | null;
  dueDate: string | null;
};

const MARKERS = [
  /^\s*(?:[-*•]\s*)?\[\s?\]\s+(.+)$/i, // - [ ] do thing
  /^\s*(?:[-*•]\s*)?(?:AI|A\/I|action(?: item)?|todo|to-do|follow[- ]?up|next step)\s*[:\-–]\s*(.+)$/i,
  /^\s*(?:[-*•]\s*)?(@[\w.\-]+\s+(?:to|will|owns?)\s+.+)$/i, // @sam to send deck
  /^\s*(?:[-*•]\s*)?([A-Z][a-z]+(?: [A-Z][a-z]+)?\s+(?:to|will)\s+(?:send|share|follow|schedule|update|review|confirm|draft|create|set up|setup|provide|check|investigate|reach out|sync|align|book|own)\b.+)$/,
];

/**
 * Pull action items out of free-form meeting notes. Recognises:
 *   - [ ] checkbox lines
 *   AI: / Action: / TODO: / Follow-up: prefixes
 *   "@owner to ..." and "Name to/will <verb> ..."
 * Owners: "@name", "(owner: name)", "Name to ...". Dues: "by 12/5", "due 2026-12-05", "by Nov 30".
 */
export function extractActionItems(body: string, refYear = new Date().getFullYear()): ExtractedAction[] {
  const out: ExtractedAction[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:[-*•]\s*)?\[x\]/i.test(line)) continue; // already done
    let text: string | null = null;
    for (const re of MARKERS) {
      const m = line.match(re);
      if (m) {
        text = m[1].trim();
        break;
      }
    }
    if (!text) continue;
    out.push({ text: cleanText(text), owner: findOwner(text), dueDate: findDue(text, refYear) });
  }
  return out;
}

function cleanText(t: string) {
  return t.replace(/\s+/g, " ").trim();
}

function findOwner(t: string): string | null {
  let m = t.match(/\((?:owner|own|assignee)\s*[:=]\s*([^)]+)\)/i);
  if (m) return m[1].trim();
  m = t.match(/@([\w.\-]+)/);
  if (m) return m[1];
  m = t.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:to|will)\s/);
  if (m) return m[1];
  m = t.match(/[-–]\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*$/);
  return m ? m[1] : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function findDue(t: string, refYear: number): string | null {
  let m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
  if (m) return m[1];
  m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : refYear;
    return toIsoDate(`${m[1]}/${m[2]}/${y}`);
  }
  m = t.match(/\b(?:by|due|before|on|eta)\s*:?\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon >= 0) {
      const y = m[3] ? Number(m[3]) : refYear;
      return `${y}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * Convert Confluence "storage format" XHTML to plain text, turning
 * <ac:task> items into "- [ ] ..." lines so the extractor picks them up.
 */
export function confluenceStorageToText(html: string): string {
  let s = html;
  s = s.replace(/<ac:task>([\s\S]*?)<\/ac:task>/g, (_, inner: string) => {
    const done = /<ac:task-status>\s*complete\s*<\/ac:task-status>/.test(inner);
    const body = (inner.match(/<ac:task-body>([\s\S]*?)<\/ac:task-body>/)?.[1] ?? "")
      .replace(/<ri:user[^>]*ri:username="([^"]+)"[^>]*\/>/g, "@$1")
      .replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, " by $1");
    return `\n- [${done ? "x" : " "}] ${body}\n`;
  });
  s = s
    .replace(/<ri:user[^>]*ri:username="([^"]+)"[^>]*\/>/g, "@$1")
    .replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, "$1")
    .replace(/<\/(p|li|h[1-6]|tr|div)>/g, "\n")
    .replace(/<li[^>]*>/g, "- ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/t[dh]>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, a) => l || (a[i - 1] ?? "") !== "")
    .join("\n")
    .trim();
}
