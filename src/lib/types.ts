/**
 * Core domain types.
 *
 * Every Jira issue is normalised into an `Issue`. Its `level` is derived from
 * issue type + labels (see `jira/classify.ts`) and drives the hierarchy:
 *
 *   Outcome
 *     └─ Critical Path Milestone (CPM)          via "contains" link
 *          └─ Interim Milestone + "Intent" label  via "contains" link
 *               └─ Interim Milestone (no label)   via "contains" link
 *                    └─ Epic                      via "contains" link
 *                         └─ Story / Task / Bug   via Epic Link / parent
 */

export type Level =
  | "outcome"
  | "cpm"
  | "ipm_intent"
  | "ipm"
  | "epic"
  | "story"
  | "risk"
  | "decision"
  | "action"
  | "other";

export const LEVEL_LABEL: Record<Level, string> = {
  outcome: "Outcome",
  cpm: "Critical Path Milestone",
  ipm_intent: "Interim Milestone (Intent)",
  ipm: "Interim Milestone",
  epic: "Epic",
  story: "Story / Item",
  risk: "Risk",
  decision: "Decision",
  action: "Action Item",
  other: "Other",
};

export const LEVEL_SHORT: Record<Level, string> = {
  outcome: "OUT",
  cpm: "CPM",
  ipm_intent: "IPM-I",
  ipm: "IPM",
  epic: "EPIC",
  story: "ITEM",
  risk: "RISK",
  decision: "DEC",
  action: "AI",
  other: "—",
};

/** Hierarchy rank: lower number = higher in the tree. */
export const LEVEL_RANK: Partial<Record<Level, number>> = {
  outcome: 0,
  cpm: 1,
  ipm_intent: 2,
  ipm: 3,
  epic: 4,
  story: 5,
};

export type StatusCategory = "new" | "indeterminate" | "done";

export type Issue = {
  key: string;
  issueType: string;
  level: Level;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  assignee: string | null;
  startDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  labels: string[];
  components: string[];
  subTrack: string | null;
  platforms: string[]; // from "Domain: X" labels
  tier: number | null; // risks & decisions: 1 | 2 | 3
  parentKey: string | null; // Epic Link / parent
  inScope: boolean; // true = returned by "my track" JQL; false = external (dependency)
  isIntake: boolean; // program action item from intake board
  description: string | null;
  updatedAt: string | null; // Jira's updated timestamp
  syncedAt: string;
  source: "jira" | "import" | "demo";
};

export type Link = {
  fromKey: string;
  toKey: string;
  /** Jira link type name, e.g. "Blocks", "Dependency", "Milestone". */
  typeName: string;
  /** Verb in the outward direction: "<from> <outward> <to>", e.g. "blocks", "contains". */
  outward: string;
  inward: string;
};

export type IssueChange = {
  id: number;
  key: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
};

export type PendingEdit = {
  id: number;
  key: string;
  field: EditableField;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  pushedAt: string | null;
  pushMethod: string | null;
};

export type EditableField =
  | "summary"
  | "status"
  | "assignee"
  | "startDate"
  | "dueDate"
  | "labels";

export const EDITABLE_FIELDS: EditableField[] = [
  "summary",
  "status",
  "assignee",
  "startDate",
  "dueDate",
  "labels",
];

export type Note = {
  id: number;
  title: string;
  body: string;
  meetingDate: string | null;
  source: string; // "manual" | "confluence:<id>"
  createdAt: string;
};

export type ActionItem = {
  id: number;
  noteId: number | null;
  text: string;
  owner: string | null;
  dueDate: string | null;
  status: "open" | "done";
  jiraKey: string | null;
  subTrack: string | null;
  createdAt: string;
};
