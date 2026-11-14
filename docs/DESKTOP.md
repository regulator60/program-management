# Run Track PM on your desktop, updated automatically from `main`

Your computer runs the app at `http://127.0.0.1:3000`. A small updater checks GitHub every two minutes. When `main` has a new commit, it builds and tests that commit on the side, then swaps it in. If the build or the tests fail, the version you were using keeps running.

Nothing on the internet connects to your computer; it only pulls from GitHub. The app listens only on `127.0.0.1`, so other machines can't reach it. That matters because the app has no login.

## One-time setup

You need these first:
- [Node.js](https://nodejs.org) **22.5 or newer**. Check with `node -v`.
- `git`.
- To sync with Jira, the computer must be on the network or VPN that can reach it.

Use a **dedicated clone** for the running app. Do any development in a different folder.

```bash
git clone https://github.com/regulator60/program-management.git ~/track-pm
cd ~/track-pm
cp .env.example .env.local        # add JIRA_PAT, CONFLUENCE_PAT, GOOGLE_ACCESS_TOKEN, ...
npm run desktop:install
```

`desktop:install` registers the updater to start when you log in:

| OS | Mechanism | File |
| --- | --- | --- |
| macOS | launchd agent (restarts if it stops) | `~/Library/LaunchAgents/com.trackpm.desktop.plist` |
| Linux | systemd user service (restarts if it stops) | `~/.config/systemd/user/track-pm.service` |
| Windows | Task Scheduler task "TrackPM" at logon | — |

The first start builds the app, which takes a few minutes. Then open http://127.0.0.1:3000.

## Day to day

There's nothing to do. Merge a PR into `main`, and within a couple of minutes the app on your desktop is running it. The commit it's running is shown at the bottom of the sidebar (`build abc1234`).

```bash
npm run desktop:status      # running commit, last failure, data location, recent log
npm run desktop:uninstall   # stop starting at login (data is kept)
npm run desktop             # run in the foreground instead of as a service (Ctrl+C to stop)
```

Logs are in `.releases/`:

| File | Contents |
| --- | --- |
| `runner.log` | updates and failures |
| `server.log` | the app's own output |
| `service.log` | macOS only |

## What happens on each update

1. `git fetch`, then compare `origin/main` with the commit that's running.
2. The new commit is checked out into its own folder, `.releases/<commit>`, as a git worktree.
3. That folder runs `npm ci`, then `npm test`, then `npm run build`. The running app isn't touched.
4. If all three pass: stop the old server and start the new one, which takes a few seconds. If the new one doesn't come up, the old one is restarted.
5. The last 2 builds are kept and older ones are deleted. Each holds its own `node_modules`, about 700 MB, so plan for roughly 1.5 GB of disk.

A commit that fails is logged and isn't retried; the next commit on `main` is tried as normal. To fix a bad deploy, push a fix to `main`.

If the updater script itself changes on `main`, it updates its own clone and restarts.

## Your data

Data lives outside the build folders, so every update keeps it:
- the database: `data/app.db`
- meeting-note attachments: `data/attachments/`

To keep the data somewhere else, set `DATABASE_PATH` in `.env.local` (a path relative to the clone, or an absolute path). Attachments go next to the database.

To back up, stop the app (`npm run desktop:uninstall`, or Ctrl+C), copy the `data/` folder, then start it again.

## Settings (`.env.local` in the clone)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to serve on |
| `HOST` | `127.0.0.1` | Keep it on localhost. The app has no login. |
| `TRACK_PM_POLL_SECONDS` | `120` | How often to check GitHub |
| `TRACK_PM_BRANCH` | `main` | Branch to follow |
| `DATABASE_PATH` | `data/app.db` | Where the data lives |

After changing `.env.local`, restart the updater: uninstall and install again, or restart `npm run desktop`.

## Notes for a work computer

- Check that running a local web server, and pulling code from a personal GitHub repository, are allowed on that machine.
- Real program data stays on the computer, in `data/` (gitignored). Never commit it: this repository is public.
