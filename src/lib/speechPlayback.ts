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
const FIRST_CHUNK_MAX_LENGTH = 160;
const CHUNK_MAX_LENGTH = 420;

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

function playAudio(
  data: Uint8Array<ArrayBuffer>,
  mimeType: string,
  version: number,
) {
  return new Promise<void>((resolve, reject) => {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const finish = () => {
      URL.revokeObjectURL(url);
      if (audio?.src === url) audio = null;
      if (resolveActivePlayback === finish) resolveActivePlayback = null;
      resolve();
    };
    resolveActivePlayback = finish;
    audio = new Audio(url);
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch((error) => {
      finish();
      if (version === requestVersion) reject(error);
    });
  });
}

export async function playSpeech({
  messageId,
  text,
  voice,
  speed,
}: {
  messageId: number;
  text: string;
  voice: string;
  speed: number;
}) {
  stopSpeechPlayback();
  const version = requestVersion;
  publish({ messageId, status: "loading" });

  try {
    const chunks = splitSpeechText(
      text,
      CHUNK_MAX_LENGTH,
      FIRST_CHUNK_MAX_LENGTH,
    );
    const synthesize = (chunk: string) =>
      ipc.audio.synthesizeSpeech({ text: chunk, voice, speed });
    let pending = chunks.length > 0 ? synthesize(chunks[0]) : null;
    for (let i = 0; i < chunks.length; i++) {
      const result = await pending!;
      if (version !== requestVersion) return;
      // Generate the next chunk while this one plays, so there is no silent gap
      // between chunks. If it fails, the error surfaces when its turn comes.
      pending = i + 1 < chunks.length ? synthesize(chunks[i + 1]) : null;
      pending?.catch(() => {});
      publish({ messageId, status: "playing" });
      await playAudio(result.audioData, result.mimeType, version);
      if (version !== requestVersion) return;
    }
    if (version === requestVersion) stopSpeechPlayback();
  } catch (error) {
    if (version === requestVersion) stopSpeechPlayback();
    throw error;
  }
}
