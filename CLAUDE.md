# Working agreements

@AGENTS.md

## Git workflow
- **Always work on a feature branch** named `feature/<short-topic>`, created from the latest `main`
  (or from the branch the work builds on, if it hasn't merged yet). Never commit directly to `main`.
- Push the feature branch and open a pull request into `main` when asked. Merging to `main` deploys the demo site.

## This repository is public
- Never commit real Jira, Confluence, Google Docs or meeting-note content, tokens, internal hostnames
  or company-specific configuration. Real data lives only in the local SQLite database (`data/`, gitignored)
  and attachments under `data/attachments/` (gitignored). Secrets go in `.env.local` (gitignored).
- The GitHub Pages site (`.github/workflows/pages.yml`) is a static snapshot built from fictional demo data
  (`src/lib/seed.ts`) only.

## Checks before pushing
`npm test`, `npx eslint src scripts`, `npm run build`.
