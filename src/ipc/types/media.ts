import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Media Schemas
// =============================================================================

/**
 * Schema for a single media file item.
 */
const MediaFileSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  appId: z.number(),
  appName: z.string(),
  sizeBytes: z.number(),
  modifiedAtMs: z.number(),
  mimeType: z.string(),
  // Notes kept in the app's gallery index (see media_gallery_index.ts).
  section: z.string().optional(),
  pinned: z.boolean().optional(),
  prompt: z.string().optional(),
  engine: z.string().optional(),
  createdAt: z.string().optional(),
});

export type MediaFile = z.infer<typeof MediaFileSchema>;

/**
 * Schema for listing all media across all apps.
 */
export const ListAllMediaResponseSchema = z.object({
  apps: z.array(
    z.object({
      appId: z.number(),
      appName: z.string(),
      appPath: z.string(),
      files: z.array(MediaFileSchema),
    }),
  ),
});

export const RenameMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
  newBaseName: z.string().min(1),
});

export const DeleteMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
});

export const OpenMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
});

export const MoveMediaFileParamsSchema = z.object({
  sourceAppId: z.number(),
  fileName: z.string(),
  targetAppId: z.number(),
});

export const UpdateMediaMetaParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
  /** string = set the section, null = clear it, omitted = leave alone */
  section: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

export const MediaStorageInfoSchema = z.object({
  /** Pictures currently in the apps' media folders. */
  liveBytes: z.number(),
  liveFileCount: z.number(),
  /** Pictures that aged out and now sit in the archive folder. */
  archiveBytes: z.number(),
  archiveFileCount: z.number(),
  archivePath: z.string(),
  /** The page warns once archive passes this many bytes. */
  warnBytes: z.number(),
});

export const EmptyArchiveResponseSchema = z.object({
  removedFiles: z.number(),
  removedBytes: z.number(),
});

// =============================================================================
// Media Contracts
// =============================================================================

export const mediaContracts = {
  listAllMedia: defineContract({
    channel: "list-all-media",
    input: z.void(),
    output: ListAllMediaResponseSchema,
  }),

  renameMediaFile: defineContract({
    channel: "rename-media-file",
    input: RenameMediaFileParamsSchema,
    output: z.void(),
  }),

  deleteMediaFile: defineContract({
    channel: "delete-media-file",
    input: DeleteMediaFileParamsSchema,
    output: z.void(),
  }),

  openMediaFile: defineContract({
    channel: "open-media-file",
    input: OpenMediaFileParamsSchema,
    output: z.void(),
  }),

  moveMediaFile: defineContract({
    channel: "move-media-file",
    input: MoveMediaFileParamsSchema,
    output: z.void(),
  }),

  updateMediaMeta: defineContract({
    channel: "update-media-meta",
    input: UpdateMediaMetaParamsSchema,
    output: z.void(),
  }),

  getMediaStorageInfo: defineContract({
    channel: "get-media-storage-info",
    input: z.void(),
    output: MediaStorageInfoSchema,
  }),

  openArchiveFolder: defineContract({
    channel: "open-media-archive-folder",
    input: z.void(),
    output: z.void(),
  }),

  emptyArchive: defineContract({
    channel: "empty-media-archive",
    input: z.void(),
    output: EmptyArchiveResponseSchema,
  }),
} as const;

// =============================================================================
// Media Client
// =============================================================================

export const mediaClient = createClient(mediaContracts);

// =============================================================================
// Type Exports
// =============================================================================

export type RenameMediaFileParams = z.infer<typeof RenameMediaFileParamsSchema>;
export type DeleteMediaFileParams = z.infer<typeof DeleteMediaFileParamsSchema>;
export type OpenMediaFileParams = z.infer<typeof OpenMediaFileParamsSchema>;
export type MoveMediaFileParams = z.infer<typeof MoveMediaFileParamsSchema>;
export type UpdateMediaMetaParams = z.infer<typeof UpdateMediaMetaParamsSchema>;
export type MediaStorageInfo = z.infer<typeof MediaStorageInfoSchema>;
export type EmptyArchiveResponse = z.infer<typeof EmptyArchiveResponseSchema>;
