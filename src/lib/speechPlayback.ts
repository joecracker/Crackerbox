import { ipc } from "@/ipc/types";
import { splitSpeechText } from "@/lib/speechText";

export type SpeechPlaybackState = {
  messageId: number | null;
  status: "idle" | "loading" | "playing";
};

let state: SpeechPlaybackState = { messageId: null, status: "idle" };
let audio: HTMLAudioElement | null = null;
let resolveActivePlayback: (() => void) | null = null;
let requestVersion = 0;
const listeners = new Set<(state: SpeechPlaybackState) => void>();

// A short first chunk means the voice starts after about one sentence instead of
// after the whole opening paragraph has been generated.
const FIRST_CHUNK_MAX_LENGTH = 100;
const CHUNK_MAX_LENGTH = 140;
// OpenRouter reports a 4,096-unit context window. Leave headroom while keeping
// normal replies in one continuous MP3.
export const CLOUD_CHUNK_MAX_LENGTH = 3_000;

function publish(next: SpeechPlaybackState) {
  state = next;
  for (const listener of listeners) listener(state);
}

export function subscribeToSpeechPlayback(
  listener: (state: SpeechPlaybackState) => void,
) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function stopSpeechPlayback() {
  requestVersion += 1;
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  resolveActivePlayback?.();
  resolveActivePlayback = null;
  publish({ messageId: null, status: "idle" });
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function playAudio(
  audioBase64: string,
  mimeType: string,
  version: number,
  playbackRate?: number,
) {
  return new Promise<void>((resolve, reject) => {
    const blob = new Blob([base64ToBytes(audioBase64)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (audio?.src === url) audio = null;
      if (resolveActivePlayback === finish) resolveActivePlayback = null;
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    resolveActivePlayback = finish;
    audio = new Audio(url);
    if (playbackRate !== undefined) {
      audio.playbackRate = playbackRate;
      audio.preservesPitch = true;
    }
    audio.onended = finish;
    audio.onerror = () => {
      cleanup();
      if (version === requestVersion) {
        reject(new Error("This device could not play the generated speech."));
      } else {
        resolve();
      }
    };
    audio.play().catch((error) => {
      cleanup();
      if (version === requestVersion) reject(error);
      else resolve();
    });
  });
}

export async function playSpeech({
  messageId,
  text,
  voice,
  speed,
  provider,
}: {
  messageId: number;
  text: string;
  voice: string;
  speed: number;
  provider: "openrouter" | "local";
}) {
  stopSpeechPlayback();
  const version = requestVersion;
  publish({ messageId, status: "loading" });

  try {
    const synthesize = (
      chunk: string,
      selectedProvider: "openrouter" | "local",
    ) =>
      ipc.audio.synthesizeSpeech({
        text: chunk,
        voice,
        speed,
        provider: selectedProvider,
      });

    const playLocal = async (localText: string) => {
      const chunks = splitSpeechText(
        localText,
        CHUNK_MAX_LENGTH,
        FIRST_CHUNK_MAX_LENGTH,
      );
      let pending = chunks.length > 0 ? synthesize(chunks[0], "local") : null;
      for (let i = 0; i < chunks.length; i++) {
        const result = await pending!;
        if (version !== requestVersion) return;
        // Generate the next chunk while this one plays, so there is no silent
        // gap between chunks. If it fails, the error surfaces when its turn comes.
        pending =
          i + 1 < chunks.length ? synthesize(chunks[i + 1], "local") : null;
        pending?.catch(() => {});
        publish({ messageId, status: "playing" });
        await playAudio(result.audioBase64, result.mimeType, version);
        if (version !== requestVersion) return;
      }
    };

    if (provider === "openrouter") {
      const cloudChunks =
        text.length <= CLOUD_CHUNK_MAX_LENGTH
          ? [text]
          : splitSpeechText(
              text,
              CLOUD_CHUNK_MAX_LENGTH,
              CLOUD_CHUNK_MAX_LENGTH,
            );
      let pending = synthesize(cloudChunks[0], "openrouter");

      for (let i = 0; i < cloudChunks.length; i++) {
        let result: Awaited<ReturnType<typeof synthesize>>;
        try {
          result = await pending;
        } catch {
          if (version !== requestVersion) return;
          await playLocal(cloudChunks.slice(i).join(" "));
          if (version === requestVersion) stopSpeechPlayback();
          return;
        }
        if (version !== requestVersion) return;

        // Buffer the following cloud piece while this MP3 plays. This keeps
        // long replies moving without replaying already heard text on fallback.
        if (i + 1 < cloudChunks.length) {
          pending = synthesize(cloudChunks[i + 1], "openrouter");
          pending.catch(() => {});
        }
        try {
          publish({ messageId, status: "playing" });
          await playAudio(result.audioBase64, result.mimeType, version, speed);
        } catch {
          if (version !== requestVersion) return;
          await playLocal(cloudChunks.slice(i).join(" "));
          if (version === requestVersion) stopSpeechPlayback();
          return;
        }
        if (version !== requestVersion) return;
      }
    } else {
      await playLocal(text);
    }
    if (version === requestVersion) stopSpeechPlayback();
  } catch (error) {
    if (version === requestVersion) stopSpeechPlayback();
    throw error;
  }
}
