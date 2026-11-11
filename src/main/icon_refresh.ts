import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log";

const logger = log.scope("icon_refresh");

// Every install rewrites Crackerbox.exe, and Explorer keeps drawing a stale
// generic icon for the Desktop, Start Menu and taskbar shortcuts. After the
// first start of a new build, ask Explorer to redraw them (no restart, no
// cache deletion).
export function refreshIconsAfterInstall(userDataDir: string): void {
  if (process.platform !== "win32") return;
  try {
    const key = String(fs.statSync(process.execPath).mtimeMs);
    const marker = path.join(userDataDir, "last-icon-refresh.txt");
    let last = "";
    try {
      last = fs.readFileSync(marker, "utf8").trim();
    } catch {
      // first run
    }
    if (last === key) return;
    const home = os.homedir();
    const paths = [
      process.execPath,
      path.join(home, "Desktop", "Crackerbox.lnk"),
      path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Crackerbox", "Crackerbox.lnk"),
      path.join(home, "AppData", "Roaming", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "Crackerbox.lnk"),
      path.join(home, "AppData", "Roaming", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "Crackerbox (2).lnk"),
    ].filter((p) => fs.existsSync(p));
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    const lnkList = paths.filter((p) => p.endsWith(".lnk")).map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    const exeQ = `'${process.execPath.replace(/'/g, "''")}'`;
    const script = [
      "Start-Sleep -Seconds 45",
      "$sh=New-Object -ComObject WScript.Shell",
      `foreach($p in @(${lnkList})){ try{ $l=$sh.CreateShortcut($p); $l.TargetPath=${exeQ}; $l.WorkingDirectory=(Split-Path ${exeQ}); $l.IconLocation=${exeQ}+",0"; $l.Save() }catch{} }`,
      "Add-Type -Namespace W -Name N -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern void SHChangeNotify(int e,int f,string a,string b); [System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int e,int f,System.IntPtr a,System.IntPtr b);'",
      `foreach($p in @(${list})){ [W.N]::SHChangeNotify(0x2000,0x5,$p,$null) }`,
      "[W.N]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)",
    ].join("; ");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: "ignore", detached: true },
    );
    child.unref();
    fs.writeFileSync(marker, key);
  } catch (error) {
    logger.warn("icon refresh failed", error);
  }
}