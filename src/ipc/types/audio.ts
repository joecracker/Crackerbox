import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Transcription Schemas
// =============================================================================

export const MAX_AUDIO_RECORDING_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const AUDIO_RECORDING_TIMESLICE_MS = 1000;
export const MAX_AUDIO_FILENAME_LENGTH = 255;
export const MAX_AUDIO_REQUEST_ID_LENGTH = 128;
export const AUDIO_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export const TranscribeAudioParamsSchema = z.object({
  audioData: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength > 0, "Audio data cannot be empty")
    .refine(
      (data) => data.byteLength <= MAX_AUDIO_RECORDING_BYTES,
      `Audio data cannot exceed ${MAX_AUDIO_RECORDING_BYTES} bytes`,
    ),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AUDIO_FILENAME_LENGTH)
    .refine(
      (filename) =>
        !filename.includes("/") &&
        !filename.includes("\\") &&
        filename !== "." &&
        filename !== "..",
      "Filename must not contain path separators or traversal segments",
    ),
  requestId: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AUDIO_REQUEST_ID_LENGTH)
    .regex(AUDIO_REQUEST_ID_PATTERN, "Request ID contains invalid characters"),
});

export type TranscribeAudioParams = z.infer<typeof TranscribeAudioParamsSchema>;

export const TranscribeAudioResultSchema = z.object({
  text: z.string(),
});

export type TranscribeAudioResult = z.infer<typeof TranscribeAudioResultSchema>;

export const SynthesizeSpeechParamsSchema = z.object({
  text: z.string().min(1).max(12_000),
  voice: z.string().min(1).max(64),
  speed: z.number().min(0.7).max(1.35),
  provider: z.enum(["openrouter", "venice", "local", "pocket"]),
});

export const SynthesizeSpeechResultSchema = z.object({
  // Base64 text, not raw bytes: the phone link carries IPC as JSON, which
  // turns a Uint8Array into a plain object the phone cannot play.
  audioBase64: z.string().min(1),
  mimeType: z.enum(["audio/wav", "audio/mpeg"]),
});

export const ListPocketVoicesResultSchema = z.object({
  /** Voices made from sound files in the My voices folder. */
  custom: z.array(z.object({ id: z.string(), label: z.string() })),
  /** The My voices folder, so Settings can say where it is. */
  folder: z.string(),
});

export type ListPocketVoicesResult = z.infer<
  typeof ListPocketVoicesResultSchema
>;

export const CreatePocketVoiceParamsSchema = z.object({
  name: z.string().trim().min(1).max(56),
  /** ".wav", ".flac", ".mp3" or ".ogg" */
  extension: z.string().min(1).max(8),
  audioData: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength > 0, "Recording cannot be empty")
    .refine(
      (data) => data.byteLength <= 25 * 1024 * 1024,
      "Recording cannot exceed 25 MB",
    ),
});

export const CreatePocketVoiceResultSchema = z.object({
  id: z.string(),
  label: z.string(),
});

// =============================================================================
// Contracts
// =============================================================================

export const audioContracts = {
  synthesizeSpeech: defineContract({
    channel: "speech:synthesize" as const,
    input: SynthesizeSpeechParamsSchema,
    output: SynthesizeSpeechResultSchema,
  }),
  listPocketVoices: defineContract({
    channel: "speech:list-pocket-voices" as const,
    input: z.void(),
    output: ListPocketVoicesResultSchema,
  }),
  createPocketVoice: defineContract({
    channel: "speech:create-pocket-voice" as const,
    input: CreatePocketVoiceParamsSchema,
    output: CreatePocketVoiceResultSchema,
  }),
  deletePocketVoice: defineContract({
    channel: "speech:delete-pocket-voice" as const,
    input: z.object({ id: z.string().min(1).max(64) }),
    output: z.void(),
  }),
  openPocketVoicesFolder: defineContract({
    channel: "speech:open-pocket-voices-folder" as const,
    input: z.void(),
    output: z.void(),
  }),
  transcribeAudio: defineContract({
    channel: "pro:transcribe-audio" as const,
    input: TranscribeAudioParamsSchema,
    output: TranscribeAudioResultSchema,
  }),
};

// =============================================================================
// Client
// =============================================================================

export const audioClient = createClient(audioContracts);
