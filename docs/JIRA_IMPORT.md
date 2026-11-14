# Pushing changes to Jira

You edit dates, status, summary, assignee or labels in this app. Those edits are **staged locally** (shown as `PENDING`) and only go to Jira when you push them. You can push them two ways.

## Option A: CSV import (recommended)

Use this when Jira Server is unreliable with REST writes. It goes through Jira's own importer and lets you check every row before anything changes.

1. Open **Data & Jira sync → Push changes to Jira** and click **Download update CSV**. The file has:
   - an `Issue Key` and a `Summary` column on every row (the importer requires both)
   - one column for each field you edited (for example `Due Date` or `Start Date`)
   - every row filled in, using the current Jira value wherever you didn't change it. An empty cell can blank the field in Jira.
2. In Jira, go to **Administration (cog) → System → Import & Export → External System Import → CSV**.
   - You need the *Jira Administrators* global permission. Without it, ask a Jira admin to run the import, or use **Bulk Change** (see the end of this page).
3. Upload the CSV and pick the project.
   - Set the **date format** to `yyyy-MM-dd`.
   - Leave the delimiter as `,`.
4. **Map the fields:**
   - `Issue Key` → **Issue Key**. This makes the importer update existing issues instead of creating new ones.
   - `Summary` → **Summary**
   - `Due Date` → **Due Date**
   - `Start Date` → your start date custom field (the name is in `csvColumns.startDate` in Settings)
   - `Labels` → **Labels**. Each `Labels` column is one label. Labels you include *replace* the issue's labels.
   - `Status` → **Status**, but only if your workflow lets the importer set status. Many workflows don't, so push status changes with REST or change them by hand.
   - `Assignee` → **Assignee**. Use Jira usernames, not display names.
   - `Comment Body` → **Comment Body**. Comments staged from meeting notes are added to the issue. Each `Comment Body` column is one comment. Check in the validation step that comments are added to existing issues on your Jira version; if they aren't, push comments with REST instead.
5. Click **Validate**. Check that it says *updating* N issues, not *creating* them. If it says creating, your Jira version doesn't update by key; stop there and use Option B or Bulk Change.
6. Run the import. Save the importer configuration file it offers, so the mapping is one click next time.
7. Back in this app, click **Mark as imported**, then **Sync now** (or re-import an export). Jira's values become the local values.

## Option B: REST push

Click **Push via REST**. The app sends one issue at a time, with a pause between calls (`jira.writeDelayMs` in Settings):

- `PUT /rest/api/2/issue/{key}` for summary, dates, labels and assignee
- `GET` then `POST /rest/api/2/issue/{key}/transitions` for status. This only works if there is a transition from the current status to the one you entered.
- `POST /rest/api/2/issue/{key}/comment` for each staged comment

An issue that fails stays pending, and the error appears on the sync page.

## New action items → Jira issues

On **Action items**, click **Export N for Jira import**. You get a CSV that *creates* issues:

- Issue type: the first entry in `issueTypes.action`
- Labels: the `intake` label plus the sub-track label

Import it the same way as Option A, but don't map an Issue Key. When the issues exist, type their keys into the **Jira key** column so the local items stay linked.

## Fallback: Bulk Change

If you can't use the importer, you can still apply the CSV by hand:

1. Search in the issue navigator with `key in (A-1, A-2, …)`.
2. Choose **Tools → Bulk Change → Edit Issues** and set one field value for all of them.

Do this once for each distinct value. It's tedious, but it needs no admin rights.
