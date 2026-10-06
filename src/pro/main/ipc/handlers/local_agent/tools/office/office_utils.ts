import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { resolveAttachmentLogicalPath } from "@/ipc/utils/media_path_utils";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import type { AgentContext } from "../types";

/** Resolve an `attachments:<name>` or app-relative path to an existing file. */
export async function resolveInputFile(
  ctx: AgentContext,
  inputPath: string,
): Promise<string> {
  let fullPath: string;
  if (inputPath.startsWith("attachments:")) {
    const attachment = await resolveAttachmentLogicalPath(
      ctx.appPath,
      inputPath,
    );
    if (!attachment) {
      throw new DyadError(
        `Attachment does not exist: ${inputPath}`,
        DyadErrorKind.NotFound,
      );
    }
    fullPath = attachment.filePath;
  } else {
    fullPath = safeJoin(ctx.appPath, inputPath);
  }
  try {
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) {
      throw new DyadError(`Not a file: ${inputPath}`, DyadErrorKind.Validation);
    }
  } catch (error) {
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      `File does not exist: ${inputPath}`,
      DyadErrorKind.NotFound,
    );
  }
  return fullPath;
}

/** Write a binary file inside the app, with the same guards as write_file. */
export async function writeOutputFile(
  ctx: AgentContext,
  relativePath: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  if (relativePath.startsWith("attachments:")) {
    throw new DyadError(
      "Output paths must be inside the app (not attachments:). Use a path such as docs/proposal.docx.",
      DyadErrorKind.Validation,
    );
  }
  const operationPath = await assertMutationPathAllowed({
    appPath: ctx.appPath,
    relativePath,
  });
  const fullPath = safeJoin(ctx.appPath, operationPath);
  await withLock(await getFileWriteKey(fullPath), async () => {
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, data);
    queueCloudSandboxSnapshotSync({
      appId: ctx.appId,
      changedPaths: [operationPath],
    });
  });
  return operationPath;
}

export function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

export function encodeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// LibreOffice (headless) — used for legacy formats and format conversion
// ---------------------------------------------------------------------------

function libreOfficeCandidates(): string[] {
  const fromEnv = process.env.LIBREOFFICE_PATH
    ? [process.env.LIBREOFFICE_PATH]
    : [];
  if (process.platform === "win32") {
    return [
      ...fromEnv,
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
  }
  if (process.platform === "darwin") {
    return [...fromEnv, "/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  }
  return [
    ...fromEnv,
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/bin/libreoffice",
    "/snap/bin/libreoffice",
  ];
}

export function findLibreOffice(): string | null {
  for (const candidate of libreOfficeCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Convert a file with headless LibreOffice. Returns the converted file's path
 * inside a temp directory plus a cleanup function the caller must run.
 */
export async function convertWithLibreOffice(params: {
  inputFile: string;
  targetFormat: string;
}): Promise<{ outputFile: string; cleanup: () => Promise<void> }> {
  const soffice = findLibreOffice();
  if (!soffice) {
    throw new DyadError(
      "LibreOffice is not installed (looked in the standard install locations; set LIBREOFFICE_PATH to override). It is needed to open or convert this file type.",
      DyadErrorKind.Precondition,
    );
  }
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "crackerbox-lo-"));
  const outDir = path.join(workDir, "out");
  const profileDir = path.join(workDir, "profile");
  await fsp.mkdir(outDir, { recursive: true });
  const cleanup = async () => {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  };

  // Copy the input so LibreOffice never touches (or locks) the original.
  const inputCopy = path.join(workDir, path.basename(params.inputFile));
  await fsp.copyFile(params.inputFile, inputCopy);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        soffice,
        [
          "--headless",
          "--norestore",
          "--nolockcheck",
          "--nodefault",
          "--nologo",
          `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
          "--convert-to",
          params.targetFormat,
          "--outdir",
          outDir,
          inputCopy,
        ],
        { timeout: 180_000, windowsHide: true },
        (error, _stdout, stderr) => {
          if (error) {
            reject(
              new DyadError(
                `LibreOffice conversion failed: ${error.message}${stderr ? ` — ${stderr}` : ""}`,
                DyadErrorKind.External,
              ),
            );
          } else {
            resolve();
          }
        },
      );
    });
    const produced = (await fsp.readdir(outDir))[0];
    if (!produced) {
      throw new DyadError(
        "LibreOffice did not produce an output file.",
        DyadErrorKind.External,
      );
    }
    return { outputFile: path.join(outDir, produced), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
