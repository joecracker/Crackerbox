import { createTypedHandler } from "./base";
import { mediaContracts } from "../types/media";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "../utils/path_utils";
import { getMimeType, MIME_TYPE_MAP } from "../utils/mime_utils";
import { DYAD_MEDIA_DIR_NAME } from "../utils/media_path_utils";
import {
  patchMediaMeta,
  readMediaMeta,
  removeMediaMeta,
  renameMediaMeta,
  moveMediaMeta,
} from "../utils/media_gallery_index";
import {
  ARCHIVE_WARN_BYTES,
  emptyArchive,
  getArchiveInfo,
  getArchiveRoot,
} from "../utils/media_archive";
import { INVALID_FILE_NAME_CHARS } from "../../shared/media_validation";
import { ensureDyadGitignored } from "./gitignoreUtils";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  app as electronApp,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { assertTrustedRenderer } from "../utils/renderer_security";
import { mediaSendContracts } from "../types/media";
import {
  getMediaThumbnailCacheRoot,
  invalidateMediaThumbnailCache,
} from "../utils/media_thumbnail";

const logger = log.scope("media_handlers");

const SUPPORTED_MEDIA_EXTENSIONS = Object.keys(MIME_TYPE_MAP);

async function getMediaFilesForApp(
  appId: number,
  appName: string,
  appPath: string,
) {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  try {
    await fs.promises.access(mediaDir);
  } catch {
    return [];
  }

  const entries = await fs.promises.readdir(mediaDir, { withFileTypes: true });
  const mediaEntries = entries.filter((entry) => {
    if (!entry.isFile()) return false;
    const ext = path.extname(entry.name).toLowerCase();
    return SUPPORTED_MEDIA_EXTENSIONS.includes(ext);
  });

  const metaIndex = await readMediaMeta(appPath);

  const results = await Promise.all(
    mediaEntries.map(async (entry) => {
      const fullPath = path.join(mediaDir, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        return {
          fileName: entry.name,
          filePath: fullPath,
          appId,
          appName,
          sizeBytes: stat.size,
          modifiedAtMs: stat.mtimeMs,
          mimeType: getMimeType(path.extname(entry.name).toLowerCase()),
          ...metaIndex[entry.name],
        };
      } catch {
        // File was deleted between readdir and stat — skip it
        return null;
      }
    }),
  );

  return results.filter((f) => f !== null);
}

async function withMediaLock<T>(
  appIds: number[],
  fn: () => Promise<T>,
  repositoryAppIds: readonly number[] = [],
): Promise<T> {
  const uniqueSortedIds = [...new Set(appIds)].sort((a, b) => a - b);
  const repositoryIds = new Set(repositoryAppIds);

  const runWithLock = async (index: number): Promise<T> => {
    if (index >= uniqueSortedIds.length) {
      return fn();
    }

    const claimsRepository = repositoryIds.has(uniqueSortedIds[index]);
    return appOperationCoordinator.run(
      {
        appId: uniqueSortedIds[index],
        operation: "mutate-media",
        resources: [
          readAppResource("app-path"),
          "media",
          ...(claimsRepository ? (["repository"] as const) : []),
        ],
        // Moving into an app may update that target's .gitignore. A recording
        // owns its repository for the whole session, so refuse at the target's
        // admission instead of queueing the cross-app move indefinitely.
        refuseWhenRecording: claimsRepository
          ? "move an image into this app"
          : undefined,
      },
      () => runWithLock(index + 1),
    );
  };

  return runWithLock(0);
}

function assertSafeFileName(fileName: string): void {
  if (!fileName || fileName.trim().length === 0) {
    throw new DyadError("File name is required", DyadErrorKind.Validation);
  }

  if (fileName !== path.basename(fileName)) {
    throw new DyadError("Invalid file name", DyadErrorKind.Validation);
  }

  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".." ||
    INVALID_FILE_NAME_CHARS.test(fileName)
  ) {
    throw new DyadError("Invalid file name", DyadErrorKind.Validation);
  }
}

function assertSafeBaseName(baseName: string): string {
  const trimmed = baseName.trim();

  if (!trimmed) {
    throw new DyadError("New image name is required", DyadErrorKind.Validation);
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    INVALID_FILE_NAME_CHARS.test(trimmed)
  ) {
    throw new DyadError("Invalid image name", DyadErrorKind.Validation);
  }

  return trimmed;
}

function assertSupportedMediaExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  if (!SUPPORTED_MEDIA_EXTENSIONS.includes(extension)) {
    throw new DyadError(
      "Unsupported media file extension",
      DyadErrorKind.Validation,
    );
  }

  return extension;
}

function getMediaFilePath(appPath: string, fileName: string): string {
  assertSafeFileName(fileName);
  assertSupportedMediaExtension(fileName);
  return safeJoin(appPath, DYAD_MEDIA_DIR_NAME, fileName);
}

function getMediaDirectoryPath(appPath: string): string {
  return path.join(appPath, DYAD_MEDIA_DIR_NAME);
}

async function invalidateThumbnail(filePath: string): Promise<void> {
  try {
    await invalidateMediaThumbnailCache(
      getMediaThumbnailCacheRoot(electronApp.getPath("sessionData")),
      filePath,
    );
  } catch (error) {
    // Cache cleanup must not turn a successful user file operation into an
    // error. The stale derivative is path-keyed and can no longer be served.
    logger.warn(`Could not invalidate media thumbnail cache`, error);
  }
}

async function getAppOrThrow(appId: number) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  return app;
}

export function registerMediaHandlers() {
  createTypedHandler(mediaContracts.listAllMedia, async () => {
    const allApps = await db.select().from(apps);
    const appResults = await Promise.all(
      allApps.map(async (app) => {
        const appPath = getDyadAppPath(app.path);
        const files = await getMediaFilesForApp(app.id, app.name, appPath);
        if (files.length > 0) {
          return {
            appId: app.id,
            appName: app.name,
            appPath,
            files,
          };
        }
        return null;
      }),
    );

    return { apps: appResults.filter((r) => r !== null) };
  });

  createTypedHandler(mediaContracts.renameMediaFile, async (_, params) => {
    await withMediaLock([params.appId], async () => {
      const app = await getAppOrThrow(params.appId);
      const appPath = getDyadAppPath(app.path);

      const sourcePath = getMediaFilePath(appPath, params.fileName);

      const sourceExtension = assertSupportedMediaExtension(params.fileName);
      const newBaseName = assertSafeBaseName(params.newBaseName);
      const destinationFileName = `${newBaseName}${sourceExtension}`;
      assertSafeFileName(destinationFileName);

      if (destinationFileName === params.fileName) {
        throw new DyadError(
          "New image name must be different from current name",
          DyadErrorKind.Validation,
        );
      }

      const destinationPath = safeJoin(
        appPath,
        DYAD_MEDIA_DIR_NAME,
        destinationFileName,
      );

      // Allow case-only renames on case-insensitive file systems (macOS, Windows)
      const isCaseOnlyRename =
        destinationFileName.toLowerCase() === params.fileName.toLowerCase();
      if (!isCaseOnlyRename && fs.existsSync(destinationPath)) {
        throw new DyadError(
          "A media file with that name already exists",
          DyadErrorKind.Conflict,
        );
      }

      try {
        await fs.promises.rename(sourcePath, destinationPath);
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          throw new Error(
            "File was modified or deleted before the rename could complete",
          );
        }
        throw e;
      }
      await invalidateThumbnail(sourcePath);
      await renameMediaMeta(appPath, params.fileName, destinationFileName);
      logger.log(`Renamed media file: ${sourcePath} -> ${destinationPath}`);
    });
  });

  createTypedHandler(mediaContracts.deleteMediaFile, async (_, params) => {
    await withMediaLock([params.appId], async () => {
      const app = await getAppOrThrow(params.appId);
      const appPath = getDyadAppPath(app.path);
      const filePath = getMediaFilePath(appPath, params.fileName);

      try {
        await fs.promises.unlink(filePath);
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          // File already gone — treat delete as idempotent
          logger.log(`Media file already deleted: ${filePath}`);
          return;
        }
        throw e;
      }
      await invalidateThumbnail(filePath);
      await removeMediaMeta(appPath, params.fileName);
      logger.log(`Deleted media file: ${filePath}`);
    });
  });

  createTypedHandler(mediaContracts.openMediaFile, async (_, params) => {
    const app = await getAppOrThrow(params.appId);
    const appPath = getDyadAppPath(app.path);
    const filePath = getMediaFilePath(appPath, params.fileName);
    if (!fs.existsSync(filePath)) {
      throw new DyadError("Media file not found", DyadErrorKind.NotFound);
    }
    const result = await shell.openPath(filePath);
    if (result) {
      throw new DyadError(
        `Failed to open file: ${result}`,
        DyadErrorKind.External,
      );
    }
  });

  createTypedHandler(mediaContracts.saveMediaFileAs, async (event, params) => {
    const app = await getAppOrThrow(params.appId);
    const appPath = getDyadAppPath(app.path);
    const filePath = getMediaFilePath(appPath, params.fileName);
    if (!fs.existsSync(filePath)) {
      throw new DyadError("Media file not found", DyadErrorKind.NotFound);
    }
    const ext = path.extname(params.fileName).replace(/^\./, "");
    const options = {
      title: "Save picture",
      defaultPath: path.join(electronApp.getPath("downloads"), params.fileName),
      filters: [
        { name: "Picture", extensions: [ext || "png"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    // Calls from the phone page carry a stand-in sender that has no real
    // window, so look the window up defensively.
    let win: BrowserWindow | null = null;
    try {
      win = BrowserWindow.fromWebContents(event.sender);
    } catch {
      win = BrowserWindow.getFocusedWindow();
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    await fs.promises.copyFile(filePath, result.filePath);
    return { saved: true, savedPath: result.filePath };
  });

  createTypedHandler(mediaContracts.copyMediaImage, async (_, params) => {
    const app = await getAppOrThrow(params.appId);
    const appPath = getDyadAppPath(app.path);
    const filePath = getMediaFilePath(appPath, params.fileName);
    if (!fs.existsSync(filePath)) {
      throw new DyadError("Media file not found", DyadErrorKind.NotFound);
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      throw new DyadError(
        "Could not read this picture to copy it",
        DyadErrorKind.External,
      );
    }
    clipboard.writeImage(image);
  });

  createTypedHandler(mediaContracts.showMediaInFolder, async (_, params) => {
    const app = await getAppOrThrow(params.appId);
    const appPath = getDyadAppPath(app.path);
    const filePath = getMediaFilePath(appPath, params.fileName);
    if (!fs.existsSync(filePath)) {
      throw new DyadError("Media file not found", DyadErrorKind.NotFound);
    }
    shell.showItemInFolder(filePath);
  });

  // Drag a picture out of the window. One-way because it must start inside
  // the dragstart event. The path is checked so only real media-folder
  // pictures can be dragged.
  ipcMain?.on(mediaSendContracts.startDrag.channel, (event, input: unknown) => {
    try {
      assertTrustedRenderer(event);
      const { filePath } = mediaSendContracts.startDrag.input.parse(input);
      const normalizedDir = path
        .dirname(path.resolve(filePath))
        .replace(/\\/g, "/");
      const mediaDir = DYAD_MEDIA_DIR_NAME.replace(/\\/g, "/");
      const ext = path.extname(filePath).toLowerCase();
      if (
        !normalizedDir.endsWith(`/${mediaDir}`) ||
        !SUPPORTED_MEDIA_EXTENSIONS.includes(ext) ||
        !fs.existsSync(filePath)
      ) {
        logger.warn("Ignoring drag request for non-media path");
        return;
      }
      const icon = nativeImage
        .createFromPath(filePath)
        .resize({ width: 64, quality: "good" });
      if (icon.isEmpty()) return;
      event.sender.startDrag({ file: path.resolve(filePath), icon });
    } catch (error) {
      logger.error("Could not start picture drag", error);
    }
  });

  createTypedHandler(mediaContracts.moveMediaFile, async (_, params) => {
    if (params.sourceAppId === params.targetAppId) {
      throw new DyadError(
        "Source and target apps must be different",
        DyadErrorKind.Validation,
      );
    }

    await withMediaLock(
      [params.sourceAppId, params.targetAppId],
      async () => {
        const sourceApp = await getAppOrThrow(params.sourceAppId);
        const targetApp = await getAppOrThrow(params.targetAppId);

        const sourceAppPath = getDyadAppPath(sourceApp.path);
        const targetAppPath = getDyadAppPath(targetApp.path);

        const sourcePath = getMediaFilePath(sourceAppPath, params.fileName);
        if (!fs.existsSync(sourcePath)) {
          throw new DyadError("Media file not found", DyadErrorKind.NotFound);
        }

        await ensureDyadGitignored(targetAppPath);
        const targetMediaDirectoryPath = getMediaDirectoryPath(targetAppPath);
        await fs.promises.mkdir(targetMediaDirectoryPath, { recursive: true });

        const destinationPath = safeJoin(
          targetAppPath,
          DYAD_MEDIA_DIR_NAME,
          params.fileName,
        );

        if (fs.existsSync(destinationPath)) {
          throw new Error(
            `Target app already has a media file named "${params.fileName}"`,
          );
        }

        try {
          await fs.promises.rename(sourcePath, destinationPath);
        } catch (e: any) {
          if (e?.code === "EXDEV") {
            // Cross-device move (e.g. different drives on Windows): copy then delete.
            await fs.promises.copyFile(sourcePath, destinationPath);
            try {
              await fs.promises.unlink(sourcePath);
            } catch (unlinkError: any) {
              // Source delete failed after copy succeeded — remove the copy
              // so we don't end up with duplicates.
              try {
                await fs.promises.unlink(destinationPath);
              } catch {
                // Best-effort cleanup; destination may already be gone.
              }
              throw unlinkError;
            }
          } else if (e?.code === "ENOENT") {
            throw new Error(
              "File was modified or deleted before the move could complete",
            );
          } else {
            throw e;
          }
        }

        await invalidateThumbnail(sourcePath);
        await moveMediaMeta(sourceAppPath, targetAppPath, params.fileName);
        logger.log(`Moved media file: ${sourcePath} -> ${destinationPath}`);
      },
      [params.targetAppId],
    );
  });

  createTypedHandler(mediaContracts.updateMediaMeta, async (_, params) => {
    await withMediaLock([params.appId], async () => {
      const app = await getAppOrThrow(params.appId);
      const appPath = getDyadAppPath(app.path);
      const filePath = getMediaFilePath(appPath, params.fileName);
      if (!fs.existsSync(filePath)) {
        throw new DyadError("Media file not found", DyadErrorKind.NotFound);
      }
      await patchMediaMeta(appPath, params.fileName, {
        section: params.section,
        pinned: params.pinned,
      });
    });
  });

  createTypedHandler(mediaContracts.getMediaStorageInfo, async () => {
    const allApps = await db.select().from(apps);
    let liveBytes = 0;
    let liveFileCount = 0;
    await Promise.all(
      allApps.map(async (app) => {
        const files = await getMediaFilesForApp(
          app.id,
          app.name,
          getDyadAppPath(app.path),
        );
        for (const file of files) {
          liveBytes += file.sizeBytes;
          liveFileCount += 1;
        }
      }),
    );
    const archive = await getArchiveInfo();
    return {
      liveBytes,
      liveFileCount,
      archiveBytes: archive.bytes,
      archiveFileCount: archive.fileCount,
      archivePath: archive.path,
      warnBytes: ARCHIVE_WARN_BYTES,
    };
  });

  createTypedHandler(mediaContracts.openArchiveFolder, async () => {
    const root = getArchiveRoot();
    await fs.promises.mkdir(root, { recursive: true });
    const result = await shell.openPath(root);
    if (result) {
      throw new DyadError(
        `Failed to open folder: ${result}`,
        DyadErrorKind.External,
      );
    }
  });

  createTypedHandler(mediaContracts.emptyArchive, async () => {
    const removed = await emptyArchive();
    logger.log(
      `Emptied media archive: ${removed.fileCount} files, ${removed.bytes} bytes`,
    );
    return { removedFiles: removed.fileCount, removedBytes: removed.bytes };
  });
}
