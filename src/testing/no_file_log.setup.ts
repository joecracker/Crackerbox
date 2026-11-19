// Tests must never write into the real app log. electron-log picks the same
// log file the installed app uses (%APPDATA%\Crackerbox\logs\main.log), so every
// test run used to leave hundreds of fake "errors" in it. Console output is
// left alone; only the file is turned off.
import log from "electron-log";

try {
  log.transports.file.level = false;
} catch {
  // a test that replaces electron-log wholesale has nothing to turn off
}
