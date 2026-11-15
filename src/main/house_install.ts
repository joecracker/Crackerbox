import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import log from "electron-log";
import {
  houseDir,
  readRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import type { HouseTriggerPayload } from "./house_schedule";

const logger = log.scope("house_install");

// Lets the housemaster install a build she just made. Crackerbox cannot
// install over itself, so a one-time scheduled task (outside the app) closes
// it, runs the installer, reopens it, and a wake note starts a new chat for her
// with the result. The script lives next to the user's own build routine, not
// in the repo; with no script the tool does not exist.

const TASK_NAME = "CB-Self-Install";

function installDir(): string {
  return path.join(os.homedir(), "Documents", "cb-install");
}
export function selfInstallScriptPath(): string {
  return path.join(installDir(), "self-install.ps1");
}
function preflightPath(): string {
  return path.join(installDir(), "self-install-preflight.txt");
}
function resultPath(): string {
  return path.join(installDir(), "install-result.txt");
}
export function postInstallWakePath(): string {
  return path.join(houseDir(), "post-install-wake.json");
}

export function selfInstallAvailable(): boolean {
  return process.platform === "win32" && fs.existsSync(selfInstallScriptPath());
}

interface PostInstallWake {
  sisterId: string;
  appId: number;
  note: string;
  requestedAt: string;
}

function runPowerShell(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { env: { ...process.env, ...env }, windowsHide: true },
      (error, _stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve(),
    );
  });
}

/**
 * Starts the one-time install task. Returns the helper's own pre-check
 * ("OK" or "FAIL: reason"), which it writes before it closes anything.
 */
export async function requestSelfInstall(opts: {
  sisterId: string;
  appId: number;
  note: string;
}): Promise<string> {
  if (!selfInstallAvailable())
    return "FAIL: no install helper on this computer.";
  fs.rmSync(preflightPath(), { force: true });
  const wake: PostInstallWake = {
    sisterId: opts.sisterId,
    appId: opts.appId,
    note: opts.note,
    requestedAt: new Date().toISOString(),
  };
  fs.writeFileSync(postInstallWakePath(), JSON.stringify(wake, null, 2));
  try {
    await runPowerShell(
      [
        "$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File \"' + $env:CB_SELF_INSTALL + '\"')",
        "$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited",
        `Register-ScheduledTask -TaskName ${TASK_NAME} -Action $a -Principal $p -Force | Out-Null`,
        `Start-ScheduledTask -TaskName ${TASK_NAME}`,
      ].join("; "),
      { CB_SELF_INSTALL: selfInstallScriptPath() },
    );
  } catch (e) {
    fs.rmSync(postInstallWakePath(), { force: true });
    return `FAIL: could not start the install task (${(e as Error).message.slice(0, 200)})`;
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (fs.existsSync(preflightPath())) {
      const text = fs.readFileSync(preflightPath(), "utf8").trim();
      if (text.startsWith("FAIL")) {
        fs.rmSync(postInstallWakePath(), { force: true });
      }
      return text;
    }
  }
  fs.rmSync(postInstallWakePath(), { force: true });
  return "FAIL: the install helper did not answer within 40 seconds.";
}

export function postInstallPrompt(wake: PostInstallWake): string {
  let result = "(no result file was written)";
  try {
    const stat = fs.statSync(resultPath());
    if (stat.mtimeMs >= Date.parse(wake.requestedAt)) {
      result = fs.readFileSync(resultPath(), "utf8").trim();
    }
  } catch {
    // keep the placeholder
  }
  return [
    "The install you started has finished and Crackerbox is open again. This is a new chat; you were closed mid-way, so pick up from here.",
    "",
    "Install result:",
    result,
    "",
    "What you wanted to do next:",
    wake.note,
    "",
    "Check that the installed app.asar hash matches the build hash above. Tell Tim in a line or two whether it worked, then carry on with your note.",
  ].join("\n");
}

/** After a restart, hands the waiting wake to the window; deletes it once sent. */
export function startPostInstallWake(
  send: (payload: HouseTriggerPayload) => boolean,
): void {
  let tries = 0;
  const tick = () => {
    try {
      const file = postInstallWakePath();
      if (!fs.existsSync(file)) return;
      const wake = JSON.parse(fs.readFileSync(file, "utf8")) as PostInstallWake;
      const sister = readRoster().find((s) => s.id === wake.sisterId);
      if (!sister) {
        fs.rmSync(file, { force: true });
        return;
      }
      const ok = send({
        appId: sister.appId,
        sisterId: sister.id,
        prompt: postInstallPrompt(wake),
        title: `${sister.name}: back from the install`,
      });
      if (ok) {
        fs.rmSync(file, { force: true });
        logger.info(`Post-install wake sent to ${sister.id}`);
        return;
      }
    } catch (e) {
      logger.error("Post-install wake failed", e);
      return;
    }
    if (++tries < 30) setTimeout(tick, 10_000);
  };
  setTimeout(tick, 15_000);
}
