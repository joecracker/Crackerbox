import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nativeImage } from "electron";
import { z } from "zod";
import type { ToolDefinition } from "./types";

const phoneScreenshotSchema = z.object({
  serial: z
    .string()
    .optional()
    .describe(
      "Optional. The device serial from `adb devices -l`, needed only when more than one phone or emulator is connected.",
    ),
});

const MAX_WIDTH = 700;
const ADB_TIMEOUT_MS = 20_000;

function adbExecutable(): string {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  return path.join(
    sdk,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
}

/** Serials of the devices that are connected and ready (not offline or unauthorized). */
export function parseReadyDevices(adbDevicesOutput: string): string[] {
  return adbDevicesOutput
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

function runAdb(adb: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      adb,
      args,
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: ADB_TIMEOUT_MS,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function toSmallJpeg(png: Buffer): string | null {
  try {
    let image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return null;
    if (image.getSize().width > MAX_WIDTH) {
      image = image.resize({ width: MAX_WIDTH, quality: "good" });
    }
    return `data:image/jpeg;base64,${image.toJPEG(75).toString("base64")}`;
  } catch {
    return null;
  }
}

export const phoneScreenshotTool: ToolDefinition<
  z.infer<typeof phoneScreenshotSchema>
> = {
  name: "phone_screenshot",
  description:
    "Look at the screen of the Android phone or emulator that is connected to this PC: returns a picture of what it is showing right now. Use it to check an Android app after installing it. Read-only: it never installs, changes or uninstalls anything.",
  inputSchema: phoneScreenshotSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  getConsentPreview: () => "Look at the phone screen",
  execute: async (args, ctx) => {
    const adb = adbExecutable();
    if (!fs.existsSync(adb)) {
      return `I can't find adb at ${adb}. Android's platform-tools aren't installed where Crackerbox looks; tell Tim.`;
    }
    let devices: string[];
    try {
      devices = parseReadyDevices(
        (await runAdb(adb, ["devices"])).toString("utf8"),
      );
    } catch (error) {
      return `adb didn't answer: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (devices.length === 0) {
      return "No phone or emulator is connected and ready. Ask Tim to plug in the phone with USB debugging on (and accept the prompt on the phone), or start an emulator.";
    }
    const serial =
      args.serial ?? (devices.length === 1 ? devices[0] : undefined);
    if (!serial) {
      return `More than one device is connected (${devices.join(", ")}). Call again with the serial of the one to look at.`;
    }
    if (!devices.includes(serial)) {
      return `Device ${serial} isn't connected and ready. Ready devices: ${devices.join(", ")}.`;
    }
    let png: Buffer;
    try {
      png = await runAdb(adb, ["-s", serial, "exec-out", "screencap", "-p"]);
    } catch (error) {
      return `The screenshot failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    const picture = toSmallJpeg(png);
    if (!picture) {
      return "The phone's screen picture couldn't be read. The screen may be off or locked; ask Tim to wake it and try again.";
    }
    ctx.appendUserMessage([
      {
        type: "text",
        text: `This is what the phone (${serial}) is showing right now:`,
      },
      { type: "image-url", url: picture },
    ]);
    return "Attached the current phone screen to the next message.";
  },
};
