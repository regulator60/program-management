import type { ComboOption } from "@/components/combobox";
import type { Model } from "./model";
import { LEVEL_SHORT, type ActionItem, type ProgramAssignment } from "./types";

/** Known values for pickers, so people choose instead of free-typing (they can still add new ones). */

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()))].sort((a, b) => a.localeCompare(b));

/** Jira items: your track first, then other tracks. */
export function issueOptions(m: Model): ComboOption[] {
  return [...m.issues]
    .sort((a, b) => Number(b.inScope) - Number(a.inScope) || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((i) => ({ value: i.key, label: i.summary, hint: i.inScope ? LEVEL_SHORT[i.level] : "other track" }));
}

/** Everyone who owns something: Jira assignees, action and assignment owners. */
export function peopleOptions(m: Model, actions: ActionItem[] = [], assignments: ProgramAssignment[] = []): ComboOption[] {
  return uniq([...m.issues.map((i) => i.assignee), ...actions.map((a) => a.owner), ...assignments.map((a) => a.owner)]).map(
    (value) => ({ value }),
  );
}

export const labelOptions = (m: Model): ComboOption[] => uniq(m.issues.flatMap((i) => i.labels)).map((value) => ({ value }));
export const statusOptions = (m: Model): ComboOption[] => uniq(m.issues.map((i) => i.status)).map((value) => ({ value }));
export const issueTypeOptions = (m: Model): ComboOption[] => uniq(m.issues.map((i) => i.issueType)).map((value) => ({ value }));
