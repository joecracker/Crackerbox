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
    for (const sentence of splitSpeechText(text)) {
      const result = await ipc.audio.synthesizeSpeech({
        text: sentence,
        voice,
        speed,
      });
      if (version !== requestVersion) return;
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
