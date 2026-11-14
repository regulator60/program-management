import type { AppConfig } from "../config";
import type { Issue, Link } from "../types";
import {
  classifyLevel,
  normalizeStatusCategory,
  parseTier,
  platformsFromLabels,
  prefixedLabel,
  tierFromLabels,
  toIsoDate,
} from "./classify";

/** Shape of an issue from Jira Server REST v2 (/rest/api/2/search). Only what we read. */
export type RawJiraIssue = {
  key: string;
  fields: Record<string, unknown> & {
    issuetype?: { name?: string };
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string; name?: string } | null;
    labels?: string[];
    components?: { name?: string }[];
    issuelinks?: RawIssueLink[];
    parent?: { key?: string };
    description?: string | null;
    updated?: string;
    duedate?: string | null;
  };
};

export type RawIssueLink = {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: { key?: string };
  outwardIssue?: { key?: string };
};

function fieldValue(fields: Record<string, unknown>, id: string): unknown {
  if (!id) return undefined;
  const v = fields[id];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return o.value ?? o.name ?? o.key ?? v;
  }
  return v;
}

export function normalizeIssue(
  raw: RawJiraIssue,
  cfg: AppConfig,
  opts: { inScope: boolean; source?: Issue["source"]; syncedAt: string },
): { issue: Issue; links: Link[] } {
  const f = raw.fields ?? {};
  const issueType = f.issuetype?.name ?? "Unknown";
  const labels = Array.isArray(f.labels) ? f.labels.map(String) : [];
  const components = (f.components ?? []).map((c) => c.name ?? "").filter(Boolean);
  const status = f.status?.name ?? "Unknown";

  const subTrackRaw = cfg.fields.subTrack ? fieldValue(f, cfg.fields.subTrack) : undefined;
  const subTrack =
    (subTrackRaw != null && String(subTrackRaw)) ||
    prefixedLabel(labels, cfg.labels.subTrackPrefix) ||
    null;

  const tierRaw = cfg.fields.tier ? fieldValue(f, cfg.fields.tier) : undefined;
  const tier = parseTier(tierRaw) ?? tierFromLabels(labels, cfg);

  const epicLink = fieldValue(f, cfg.fields.epicLink);
  const parentKey =
    (typeof epicLink === "string" && epicLink) || f.parent?.key || null;

  const issue: Issue = {
    key: raw.key,
    issueType,
    level: classifyLevel(issueType, labels, cfg),
    summary: f.summary ?? "",
    status,
    statusCategory: normalizeStatusCategory(f.status?.statusCategory?.key, status),
    assignee: f.assignee?.displayName ?? f.assignee?.name ?? null,
    startDate: toIsoDate(fieldValue(f, cfg.fields.startDate)),
    dueDate: toIsoDate(fieldValue(f, cfg.fields.dueDate || "duedate")),
    labels,
    components,
    subTrack,
    platforms: platformsFromLabels(labels, cfg),
    tier,
    parentKey,
    inScope: opts.inScope,
    isIntake: labels.some((l) => l.toLowerCase() === cfg.labels.intake.toLowerCase()),
    description: typeof f.description === "string" ? f.description : null,
    updatedAt: f.updated ?? null,
    syncedAt: opts.syncedAt,
    source: opts.source ?? "jira",
  };

  const links: Link[] = [];
  for (const l of f.issuelinks ?? []) {
    const typeName = l.type?.name ?? "Relates";
    const outward = l.type?.outward ?? typeName;
    const inward = l.type?.inward ?? typeName;
    if (l.outwardIssue?.key) {
      links.push({ fromKey: raw.key, toKey: l.outwardIssue.key, typeName, outward, inward });
    } else if (l.inwardIssue?.key) {
      links.push({ fromKey: l.inwardIssue.key, toKey: raw.key, typeName, outward, inward });
    }
  }
  return { issue, links };
}
