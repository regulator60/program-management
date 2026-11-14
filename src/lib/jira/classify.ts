import type { AppConfig } from "../config";
import type { Level, StatusCategory } from "../types";

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const inList = (v: string, list: string[]) => list.some((x) => eq(x, v));

export function classifyLevel(
  issueType: string,
  labels: string[],
  cfg: AppConfig,
): Level {
  const t = cfg.issueTypes;
  if (inList(issueType, t.outcome)) return "outcome";
  if (inList(issueType, t.cpm)) return "cpm";
  if (inList(issueType, t.ipm)) {
    return labels.some((l) => eq(l, cfg.labels.intent)) ? "ipm_intent" : "ipm";
  }
  if (inList(issueType, t.epic)) return "epic";
  if (inList(issueType, t.risk)) return "risk";
  if (inList(issueType, t.decision)) return "decision";
  if (inList(issueType, t.action)) return "action";
  return "story";
}

/** "Domain: Payments" / "Domain:Payments" / "domain-payments" → "Payments" */
export function platformsFromLabels(labels: string[], cfg: AppConfig): string[] {
  const prefix = cfg.labels.platformPrefix.replace(/[:\s_-]+$/, "").toLowerCase();
  const out: string[] = [];
  for (const l of labels) {
    const lower = l.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    const rest = l.slice(prefix.length).replace(/^[\s:_-]+/, "").trim();
    if (rest) out.push(rest.replace(/_/g, " "));
  }
  return [...new Set(out)];
}

export function prefixedLabel(labels: string[], prefix: string): string | null {
  if (!prefix) return null;
  const p = prefix.replace(/[:\s_-]+$/, "").toLowerCase();
  for (const l of labels) {
    if (l.toLowerCase().startsWith(p)) {
      const rest = l.slice(p.length).replace(/^[\s:_-]+/, "").trim();
      if (rest) return rest.replace(/_/g, " ");
    }
  }
  return null;
}

export function tierFromLabels(labels: string[], cfg: AppConfig): number | null {
  let re: RegExp;
  try {
    re = new RegExp(cfg.labels.tierPattern, "i");
  } catch {
    return null;
  }
  for (const l of labels) {
    const m = l.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 3) return n;
    }
  }
  return null;
}

export function parseTier(value: unknown): number | null {
  if (value == null) return null;
  const s =
    typeof value === "object" && value !== null && "value" in value
      ? String((value as { value: unknown }).value)
      : String(value);
  const m = s.match(/([123])/);
  return m ? Number(m[1]) : null;
}

/** Best-effort category when Jira doesn't hand us statusCategory (e.g. CSV export). */
export function inferStatusCategory(status: string): StatusCategory {
  const s = status.toLowerCase();
  if (/(done|closed|resolved|complete|cancel|released|accepted)/.test(s)) return "done";
  if (/(to do|todo|open|backlog|new|funnel|not started|draft|identified)/.test(s)) return "new";
  return "indeterminate";
}

export function normalizeStatusCategory(key: string | undefined, status: string): StatusCategory {
  if (key === "done" || key === "new" || key === "indeterminate") return key;
  return inferStatusCategory(status);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Accepts ISO dates/timestamps, Jira CSV style "14/Nov/26 10:00 AM",
 * "2026-11-14", "11/14/2026". Returns YYYY-MM-DD or null.
 */
export function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
