#!/usr/bin/env node
// Runs Track PM on your own computer and keeps it up to date with `main`.
//
//   node scripts/desktop-runner.mjs run        # serve + auto-update (foreground)
//   node scripts/desktop-runner.mjs install    # start automatically at login (macOS / Linux / Windows, no admin needed)
//   node scripts/desktop-runner.mjs uninstall  # stop it and don't start at login any more
//   node scripts/desktop-runner.mjs stop       # stop it now (it starts again at next login)
//   node scripts/desktop-runner.mjs status
//
// How it works:
// - Every TRACK_PM_POLL_SECONDS (default 120) it runs `git fetch` and looks at origin/main.
// - A new commit is checked out into its own folder (.releases/<sha>, a git worktree).
//   That folder gets `npm ci`, `npm test` and `npm run build`. The running app is untouched meanwhile.
// - Only if all three pass does it stop the old server and start the new one. If anything
//   fails, the old version keeps running and the failure is logged. A broken commit is not
//   retried until main moves again.
// - Data (SQLite + meeting-note attachments) lives outside the release folders, so it survives
//   every update. Default: <this clone>/data/app.db. Override with DATABASE_PATH in .env.local.
//
// Nothing connects to your computer from outside. It only pulls from GitHub.

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
const REL = join(ROOT, ".releases");
const STATE_FILE = join(REL, "state.json");
const LOG_FILE = join(REL, "runner.log");
const SERVER_LOG = join(REL, "server.log");
const PID_FILE = join(REL, "pids.json");
const WIN = process.platform === "win32";

const rootEnv = readEnvFile(join(ROOT, ".env.local"));
const setting = (k, d) => process.env[k] ?? rootEnv[k] ?? d;
const REMOTE = setting("TRACK_PM_REMOTE", "origin");
const BRANCH = setting("TRACK_PM_BRANCH", "main");
const PORT = Number(setting("PORT", "3000"));
const HOST = setting("HOST", "127.0.0.1"); // localhost only: the app has no login
const POLL_MS = Number(setting("TRACK_PM_POLL_SECONDS", "120")) * 1000;
const KEEP_RELEASES = 2;

mkdirSync(REL, { recursive: true });

// ---------------------------------------------------------------- helpers

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: WIN && cmd === "npm", // npm is npm.cmd on Windows
    windowsHide: true, // no console window flashing up every poll
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.signal})\n${tail}`);
  }
  return (r.stdout ?? "").trim();
}

const git = (...args) => run("git", args, ROOT);

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/** PIDs of the running updater and app server, so `stop` works without a service manager (Windows). */
function readPids() {
  try {
    return JSON.parse(readFileSync(PID_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writePids(p) {
  writeFileSync(PID_FILE, JSON.stringify({ ...readPids(), ...p }));
}
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Absolute database path shared by every release. */
function databasePath() {
  return resolve(ROOT, setting("DATABASE_PATH", "data/app.db"));
}

const releaseDir = (sha) => join(REL, sha.slice(0, 12));
const isBuilt = (sha) => existsSync(join(releaseDir(sha), ".next", "BUILD_ID"));

// ---------------------------------------------------------------- build

function buildRelease(sha) {
  const dir = releaseDir(sha);
  if (isBuilt(sha)) return dir;
  if (existsSync(dir)) {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    git("worktree", "prune");
  }
  log(`Building ${sha.slice(0, 7)}: checkout`);
  git("worktree", "add", "--detach", dir, sha);
  if (existsSync(join(ROOT, ".env.local"))) copyFileSync(join(ROOT, ".env.local"), join(dir, ".env.local"));
  log(`Building ${sha.slice(0, 7)}: npm ci`);
  run("npm", ["ci", "--no-audit", "--no-fund"], dir);
  log(`Building ${sha.slice(0, 7)}: npm test`);
  run("npm", ["test"], dir);
  log(`Building ${sha.slice(0, 7)}: npm run build`);
  run("npm", ["run", "build"], dir, { GIT_SHA: sha });
  return dir;
}

function cleanupReleases(keep) {
  const keepNames = new Set(keep.filter(Boolean).map((s) => s.slice(0, 12)));
  for (const name of readdirSync(REL)) {
    const p = join(REL, name);
    if (!/^[0-9a-f]{12}$/.test(name) || keepNames.has(name)) continue;
    try {
      git("worktree", "remove", "--force", p);
    } catch {
      rmSync(p, { recursive: true, force: true });
    }
  }
  git("worktree", "prune");
}

// ---------------------------------------------------------------- server

let server = null;

async function startServer(sha) {
  const dir = releaseDir(sha);
  const out = openSync(SERVER_LOG, "a");
  mkdirSync(dirname(databasePath()), { recursive: true });
  const child = spawn(
    process.execPath,
    [join(dir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", HOST],
    {
      cwd: dir,
      env: { ...process.env, ...rootEnv, DATABASE_PATH: databasePath(), NODE_ENV: "production" },
      stdio: ["ignore", out, out],
      detached: !WIN,
      windowsHide: true,
    },
  );
  let exited = false;
  child.on("exit", (code) => {
    exited = true;
    if (server === child) log(`Server exited unexpectedly (code ${code}); restarting on next check.`);
    if (server === child) server = null;
  });
  const url = `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/`;
  for (let i = 0; i < 90; i++) {
    if (exited) break;
    try {
      const r = await fetch(url);
      if (r.ok) {
        server = child;
        writePids({ server: child.pid });
        log(`Serving ${sha.slice(0, 7)} at ${url}`);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopProcess(child);
  throw new Error(`Server for ${sha.slice(0, 7)} did not come up (see ${SERVER_LOG})`);
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(() => {
      try {
        if (WIN) child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
      res();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(t);
      res();
    });
    try {
      if (WIN) child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      clearTimeout(t);
      res();
    }
  });
}

async function stopServer() {
  const s = server;
  server = null;
  await stopProcess(s);
  writePids({ server: null });
}

// ---------------------------------------------------------------- update loop

function remoteHead() {
  git("fetch", "--quiet", REMOTE, BRANCH);
  return git("rev-parse", `${REMOTE}/${BRANCH}`);
}

async function deploy(target, state) {
  const prev = state.current;
  try {
    buildRelease(target);
  } catch (e) {
    log(`✗ ${target.slice(0, 7)} failed to build/test. Keeping ${prev ? prev.slice(0, 7) : "nothing"} running.\n${e.message}`);
    writeState({ ...state, failed: target, failedAt: new Date().toISOString() });
    return false;
  }
  await stopServer();
  try {
    await startServer(target);
  } catch (e) {
    log(`✗ ${e.message}. Rolling back.`);
    writeState({ ...state, failed: target, failedAt: new Date().toISOString() });
    if (prev && isBuilt(prev)) await startServer(prev);
    return false;
  }
  const next = { current: target, previous: prev ?? null, deployedAt: new Date().toISOString() };
  writeState(next);
  cleanupReleases([target, prev].slice(0, KEEP_RELEASES));
  log(`✓ Updated to ${target.slice(0, 7)}${prev ? ` (from ${prev.slice(0, 7)})` : ""}`);
  return true;
}

/** Keep this clone's checkout in step with main so the updater itself stays current. */
async function updateSelf(target) {
  let branch;
  try {
    branch = git("rev-parse", "--abbrev-ref", "HEAD");
  } catch {
    return;
  }
  if (branch !== BRANCH || git("status", "--porcelain", "--untracked-files=no") !== "") return;
  const before = readFileSync(SCRIPT, "utf8");
  try {
    git("merge", "--ff-only", "--quiet", target);
  } catch {
    return;
  }
  if (readFileSync(SCRIPT, "utf8") === before) return;
  log("The updater itself changed; restarting it.");
  await stopServer();
  rmSync(PID_FILE, { force: true });
  if (process.env.TRACK_PM_SERVICE === "1") process.exit(0); // launchd/systemd restart us
  spawn(process.execPath, [SCRIPT, "run"], { cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true }).unref();
  process.exit(0);
}

async function tick() {
  const state = readState();
  let target;
  try {
    target = remoteHead();
  } catch (e) {
    log(`Can't reach ${REMOTE}/${BRANCH} (${e.message.split("\n")[0]}); will retry.`);
    if (!server && state.current && isBuilt(state.current)) await startServer(state.current).catch((x) => log(x.message));
    return;
  }
  if (target !== state.current && target !== state.failed) {
    if (await deploy(target, state)) await updateSelf(target);
  } else if (!server && state.current && isBuilt(state.current)) {
    await startServer(state.current).catch((e) => log(e.message));
  }
}

async function runLoop() {
  const existing = readPids().runner;
  if (existing && existing !== process.pid && isAlive(existing)) {
    console.log(`Track PM is already running (pid ${existing}). Use "npm run desktop:status" or "npm run desktop:stop".`);
    process.exit(0);
  }
  writeFileSync(PID_FILE, JSON.stringify({ runner: process.pid, server: null }));
  log(`Track PM desktop runner: ${REMOTE}/${BRANCH}, checking every ${POLL_MS / 1000}s, data at ${databasePath()}`);
  const state = readState();
  if (state.current && isBuilt(state.current)) {
    await startServer(state.current).catch((e) => log(e.message));
  }
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      log(`Unexpected error: ${e.stack ?? e}`);
    } finally {
      busy = false;
    }
  };
  await loop();
  setInterval(loop, POLL_MS);
  const shutdown = async () => {
    log("Stopping.");
    await stopServer();
    rmSync(PID_FILE, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------- install as a login service

const LABEL = "com.trackpm.desktop";
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitPath = join(homedir(), ".config", "systemd", "user", "track-pm.service");
const pathEnv = [dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function install() {
  if (process.platform === "darwin") {
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(
      plistPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(SCRIPT)}</string><string>run</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(pathEnv)}</string>
    <key>TRACK_PM_SERVICE</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(REL, "service.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(REL, "service.log"))}</string>
</dict></plist>
`,
    );
    const uid = process.getuid();
    spawnSync("launchctl", ["bootout", `gui/${uid}`, plistPath]);
    run("launchctl", ["bootstrap", `gui/${uid}`, plistPath], ROOT);
    console.log(`Installed ${plistPath}. Track PM now starts at login and keeps itself updated.`);
  } else if (process.platform === "linux") {
    mkdirSync(dirname(unitPath), { recursive: true });
    writeFileSync(
      unitPath,
      `[Unit]
Description=Track PM (auto-updating from ${REMOTE}/${BRANCH})
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${SCRIPT} run
Environment=PATH=${pathEnv}
Environment=TRACK_PM_SERVICE=1
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
    );
    run("systemctl", ["--user", "daemon-reload"], ROOT);
    run("systemctl", ["--user", "enable", "--now", "track-pm.service"], ROOT);
    console.log(`Installed ${unitPath}. Track PM now starts at login and keeps itself updated.`);
    console.log("To keep it running while logged out: loginctl enable-linger $USER");
  } else if (WIN) {
    // A shortcut in the user's own Startup folder: no admin rights needed (unlike a logon scheduled task).
    // It runs a hidden PowerShell that starts the updater with no window.
    const lnk = winShortcutPath();
    const launch = winLaunchCommand();
    const psArgs = `-NoProfile -WindowStyle Hidden -EncodedCommand ${encodePs(launch)}`;
    let added;
    try {
      powershell(
        [
          `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psq(lnk)})`,
          `$s.TargetPath = 'powershell.exe'`,
          `$s.Arguments = ${psq(psArgs)}`,
          `$s.WorkingDirectory = ${psq(ROOT)}`,
          `$s.WindowStyle = 7`,
          `$s.Description = 'Track PM (auto-updating from ${BRANCH})'`,
          `$s.Save()`,
        ].join("; "),
      );
      added = lnk;
    } catch {
      // Locked-down PowerShell (Constrained Language mode) can't create shortcuts.
      // Fall back to a .cmd in the same Startup folder. A console flashes briefly at login.
      added = lnk.replace(/\.lnk$/, ".cmd");
      writeFileSync(added, `@echo off\r\nstart "" /min powershell.exe ${psArgs}\r\n`);
    }
    console.log(`Added "${added}". Track PM now starts when you log in and keeps itself updated.`);
    if (isAlive(readPids().runner)) {
      console.log("It's already running.");
    } else {
      powershell(launch);
      console.log("Started it now.");
    }
  } else {
    throw new Error(`Unsupported platform ${process.platform}; run "node scripts/desktop-runner.mjs run" yourself.`);
  }
  console.log(`Open http://${HOST}:${PORT}/ (first start builds the app; give it a few minutes). Logs: ${LOG_FILE}`);
}

function uninstall() {
  if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]);
    rmSync(plistPath, { force: true });
  } else if (process.platform === "linux") {
    spawnSync("systemctl", ["--user", "disable", "--now", "track-pm.service"]);
    rmSync(unitPath, { force: true });
    spawnSync("systemctl", ["--user", "daemon-reload"]);
  } else if (WIN) {
    stop();
    rmSync(winShortcutPath(), { force: true });
    rmSync(winShortcutPath().replace(/\.lnk$/, ".cmd"), { force: true });
    spawnSync("schtasks", ["/Delete", "/TN", "TrackPM", "/F"], { windowsHide: true }); // older installs
  }
  console.log("Removed the login service. Your data and releases are untouched.");
}

/** Stop the running updater and its app server (it starts again at next login). */
function stop() {
  if (process.platform === "darwin" && existsSync(plistPath)) {
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]);
  } else if (process.platform === "linux" && existsSync(unitPath)) {
    spawnSync("systemctl", ["--user", "stop", "track-pm.service"]);
  }
  const { runner, server: srv } = readPids();
  let stopped = false;
  for (const pid of [srv, runner]) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid);
      stopped = true;
    } catch {}
  }
  rmSync(PID_FILE, { force: true });
  console.log(stopped ? "Stopped Track PM." : "Track PM wasn't running.");
}

// ---------------------------------------------------------------- Windows helpers

function winShortcutPath() {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Track PM.lnk");
}

/** PowerShell single-quoted literal. */
function psq(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Base64 UTF-16LE, for powershell -EncodedCommand (avoids all quoting problems with paths). */
function encodePs(cmd) {
  return Buffer.from(cmd, "utf16le").toString("base64");
}

function winLaunchCommand() {
  return `Start-Process -FilePath ${psq(process.execPath)} -ArgumentList @(${psq(`"${SCRIPT}"`)}, 'run') -WorkingDirectory ${psq(ROOT)} -WindowStyle Hidden`;
}

function powershell(cmd) {
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePs(cmd)], ROOT);
}

async function status() {
  const s = readState();
  console.log(`Branch:    ${REMOTE}/${BRANCH}`);
  console.log(`Running:   ${s.current ? s.current.slice(0, 7) : "—"}${s.deployedAt ? ` (since ${s.deployedAt})` : ""}`);
  if (s.failed) console.log(`Failed:    ${s.failed.slice(0, 7)} at ${s.failedAt} (see ${LOG_FILE})`);
  console.log(`Data:      ${databasePath()}`);
  const pids = readPids();
  console.log(`Updater:   ${isAlive(pids.runner) ? `running (pid ${pids.runner})` : "not running"}`);
  try {
    const r = await fetch(`http://${HOST}:${PORT}/`);
    console.log(`App:       http://${HOST}:${PORT}/ → HTTP ${r.status}`);
  } catch {
    console.log(`App:       http://${HOST}:${PORT}/ → not responding`);
  }
  if (existsSync(LOG_FILE)) {
    console.log("\nRecent log:");
    console.log(readFileSync(LOG_FILE, "utf8").trim().split("\n").slice(-10).join("\n"));
  }
}

const cmd = process.argv[2] ?? "run";
if (cmd === "run") await runLoop();
else if (cmd === "install") install();
else if (cmd === "uninstall") uninstall();
else if (cmd === "status") await status();
else if (cmd === "stop") stop();
else {
  console.error("Usage: node scripts/desktop-runner.mjs run|install|uninstall|stop|status");
  process.exit(1);
}
