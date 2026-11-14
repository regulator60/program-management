import type { AppConfig } from "../config";
import type { EditableField, PendingEdit } from "../types";
import type { RawJiraIssue } from "./normalize";

/**
 * Minimal Jira Server / Data Center REST v2 client.
 *
 * Auth (env vars, never stored in the DB):
 *   JIRA_PAT                     personal access token (Jira 8.14+) → "Authorization: Bearer"
 *   JIRA_USER + JIRA_PASSWORD    basic auth fallback for older servers
 *
 * Corporate CA? Start the app with NODE_EXTRA_CA_CERTS=/path/to/ca.pem.
 */
export function jiraAuthHeader(): string | null {
  if (process.env.JIRA_PAT) return `Bearer ${process.env.JIRA_PAT}`;
  if (process.env.JIRA_USER && process.env.JIRA_PASSWORD) {
    return `Basic ${Buffer.from(`${process.env.JIRA_USER}:${process.env.JIRA_PASSWORD}`).toString("base64")}`;
  }
  return null;
}

export class JiraClient {
  constructor(
    private baseUrl: string,
    private auth: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  static fromConfig(cfg: AppConfig): JiraClient {
    if (!cfg.jira.baseUrl) throw new Error("Jira base URL is not set (Settings).");
    const auth = jiraAuthHeader();
    if (!auth) throw new Error("No Jira credentials. Set JIRA_PAT (or JIRA_USER/JIRA_PASSWORD) in .env.local.");
    return new JiraClient(cfg.jira.baseUrl, auth);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        Accept: "application/json",
        "Content-Type": "application/json",
        // Jira Server rejects some writes from browsers without this; harmless server-side.
        "X-Atlassian-Token": "no-check",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira ${method} ${path} → ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  fieldList(cfg: AppConfig): string[] {
    return [
      "summary", "issuetype", "status", "assignee", "labels", "components",
      "issuelinks", "parent", "description", "updated", "duedate",
      cfg.fields.startDate, cfg.fields.dueDate, cfg.fields.epicLink, cfg.fields.tier, cfg.fields.subTrack,
    ].filter((f, i, a) => f && a.indexOf(f) === i);
  }

  async search(jql: string, cfg: AppConfig): Promise<RawJiraIssue[]> {
    const out: RawJiraIssue[] = [];
    let startAt = 0;
    const maxResults = cfg.jira.pageSize;
    for (;;) {
      const page = await this.request<{ issues: RawJiraIssue[]; total: number }>(
        "POST",
        "/rest/api/2/search",
        { jql, startAt, maxResults, fields: this.fieldList(cfg) },
      );
      out.push(...page.issues);
      startAt += page.issues.length;
      if (!page.issues.length || startAt >= page.total) break;
    }
    return out;
  }

  async getByKeys(keys: string[], cfg: AppConfig): Promise<RawJiraIssue[]> {
    const out: RawJiraIssue[] = [];
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      out.push(...(await this.search(`key in (${chunk.join(",")})`, cfg)));
    }
    return out;
  }

  async myself(): Promise<{ name: string; displayName: string }> {
    return this.request("GET", "/rest/api/2/myself");
  }

  async updateFields(key: string, fields: Record<string, unknown>) {
    await this.request("PUT", `/rest/api/2/issue/${encodeURIComponent(key)}`, { fields });
  }

  async addComment(key: string, body: string) {
    await this.request("POST", `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body });
  }

  async transitionTo(key: string, statusName: string) {
    const { transitions } = await this.request<{
      transitions: { id: string; name: string; to: { name: string } }[];
    }>("GET", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`);
    const t = transitions.find(
      (x) => x.to.name.toLowerCase() === statusName.toLowerCase() || x.name.toLowerCase() === statusName.toLowerCase(),
    );
    if (!t) {
      throw new Error(
        `No transition from current status to "${statusName}" on ${key}. Available: ${transitions.map((x) => x.to.name).join(", ")}`,
      );
    }
    await this.request("POST", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: t.id },
    });
  }
}

/** Turn staged edits for one issue into a REST field payload (+ optional status transition). */
export function editsToRestPayload(edits: PendingEdit[], cfg: AppConfig) {
  const fields: Record<string, unknown> = {};
  let status: string | null = null;
  const comments: string[] = [];
  const map: Record<Exclude<EditableField, "status" | "comment">, (v: string | null) => [string, unknown]> = {
    summary: (v) => ["summary", v ?? ""],
    dueDate: (v) => [cfg.fields.dueDate || "duedate", v],
    startDate: (v) => [cfg.fields.startDate, v],
    labels: (v) => ["labels", v ? JSON.parse(v) : []],
    // Jira Server identifies users by username ("name"), not display name.
    assignee: (v) => ["assignee", v ? { name: v } : null],
  };
  for (const e of edits) {
    if (e.field === "status") status = e.newValue;
    else if (e.field === "comment") {
      if (e.newValue) comments.push(e.newValue);
    } else {
      const [k, v] = map[e.field](e.newValue);
      fields[k] = v;
    }
  }
  return { fields, status, comments };
}
