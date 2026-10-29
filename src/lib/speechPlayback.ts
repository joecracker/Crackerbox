import { ipc } from "@/ipc/types";
import { splitSpeechIntoChunks, splitSpeechText } from "@/lib/speechText";

export type SpeechPlaybackState = {
  messageId: number | null;
  status: "idle" | "loading" | "playing";
};

let state: SpeechPlaybackState = { messageId: null, status: "idle" };
let audio: HTMLAudioElement | null = null;
let resolveActivePlayback: (() => void) | null = null;
let requestVersion = 0;
const listeners = new Set<(state: SpeechPlaybackState) => void>();

// The built-in voice makes speech at about the speed it is spoken, so it can
// only stay ahead of playback if no chunk is bigger than the one before it.
// The first chunk is the biggest, the next ones shrink a little each time, and
// they stop shrinking at a minimum size.
const FIRST_CHUNK_MAX_LENGTH = 90;
const CHUNK_SHRINK_FACTOR = 0.93;
const MIN_CHUNK_MAX_LENGTH = 70;
// OpenRouter reports a 4,096-unit context window. Leave headroom while keeping
// normal replies in one continuous MP3.
export const CLOUD_CHUNK_MAX_LENGTH = 3_000;
// The hosted voice sounds best (one continuous recording) but takes anywhere
// from 4 to 15+ seconds to start, whatever the length. So the first sentences
// are spoken by the built-in voice while the hosted one prepares the rest.
export const LOCAL_OPENING_MAX_LENGTH = 300;
// If less than this would be left for the hosted voice, it is not worth the
// wait or the handoff: the whole reply is spoken by the built-in voice.
export const MIN_CLOUD_LENGTH = 400;
// How long to keep waiting for the hosted voice once the opening has finished
// before carrying on with the built-in voice.
export const CLOUD_WAIT_MS = 6_000;

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

/** Rejects if the promise has not settled within `ms`; it is left to finish. */
function waitUpTo<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Hosted speech took too long to start.")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function splitForLocalVoice(text: string) {
  return splitSpeechIntoChunks(
    text,
    FIRST_CHUNK_MAX_LENGTH,
    CHUNK_SHRINK_FACTOR,
    MIN_CHUNK_MAX_LENGTH,
  );
}

/** The first few chunks, up to about LOCAL_OPENING_MAX_LENGTH, and the rest. */
function splitOpening(chunks: string[]) {
  let used = 0;
  let length = 0;
  while (used < chunks.length) {
    const next = chunks[used].length + (used > 0 ? 1 : 0);
    if (used > 0 && length + next > LOCAL_OPENING_MAX_LENGTH) break;
    length += next;
    used++;
  }
  return { opening: chunks.slice(0, used), rest: chunks.slice(used).join(" ") };
}

/** "openrouter" and "venice" are hosted voices; "local" runs on this PC. */
export type SpeechEngine = "openrouter" | "venice" | "local";

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
  provider: SpeechEngine;
}) {
  stopSpeechPlayback();
  const version = requestVersion;
  publish({ messageId, status: "loading" });

  try {
    const synthesize = (chunk: string, selectedProvider: SpeechEngine) =>
      ipc.audio.synthesizeSpeech({
        text: chunk,
        voice,
        speed,
        provider: selectedProvider,
      });

    // `progress.done` counts the chunks fully spoken, so a failure part-way
    // through never makes the fallback repeat what was already heard.
    const playLocalChunks = async (
      chunks: string[],
      progress?: { done: number },
    ) => {
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
        if (progress) progress.done = i + 1;
      }
    };
    const playLocal = (localText: string) =>
      playLocalChunks(splitForLocalVoice(localText));

    const localChunks = splitForLocalVoice(text);
    // Venice answers fast enough to read the whole reply, short or long, as one
    // smooth recording. The built-in voice only runs on this PC at about the
    // speed it is spoken, so it leaves a pause between sentences; with Venice
    // it is just the backup if the hosted voice does not answer in time.
    const cloudFirst = provider === "venice";
    const { opening, rest }: { opening: string[]; rest: string } = cloudFirst
      ? { opening: [], rest: text }
      : splitOpening(localChunks);

    if (
      provider !== "local" &&
      (cloudFirst ? rest.trim().length > 0 : rest.length >= MIN_CLOUD_LENGTH)
    ) {
      const cloud = provider;
      const cloudPieces =
        rest.length <= CLOUD_CHUNK_MAX_LENGTH
          ? [rest]
          : splitSpeechText(
              rest,
              CLOUD_CHUNK_MAX_LENGTH,
              CLOUD_CHUNK_MAX_LENGTH,
            );

      // Ask the hosted voice for everything after the opening right now, so it
      // is already working while the opening is spoken.
      let pending = synthesize(cloudPieces[0], cloud);
      pending.catch(() => {});

      const spoken = { done: 0 };
      try {
        await playLocalChunks(opening, spoken);
      } catch (localError) {
        if (version !== requestVersion) return;
        // The built-in voice is unavailable: let the hosted voice say the
        // rest of the opening as well.
        try {
          const unspoken = opening.slice(spoken.done).join(" ");
          const openingAudio = await synthesize(unspoken, cloud);
          if (version !== requestVersion) return;
          publish({ messageId, status: "playing" });
          await playAudio(
            openingAudio.audioBase64,
            openingAudio.mimeType,
            version,
            speed,
          );
        } catch {
          if (version !== requestVersion) return;
          throw localError;
        }
      }
      if (version !== requestVersion) return;

      for (let i = 0; i < cloudPieces.length; i++) {
        let result: Awaited<ReturnType<typeof synthesize>>;
        try {
          result = await waitUpTo(pending, CLOUD_WAIT_MS);
        } catch {
          if (version !== requestVersion) return;
          await playLocal(cloudPieces.slice(i).join(" "));
          if (version === requestVersion) stopSpeechPlayback();
          return;
        }
        if (version !== requestVersion) return;

        // Buffer the following hosted piece while this MP3 plays. This keeps
        // long replies moving without replaying already heard text on fallback.
        if (i + 1 < cloudPieces.length) {
          pending = synthesize(cloudPieces[i + 1], cloud);
          pending.catch(() => {});
        }
        try {
          publish({ messageId, status: "playing" });
          await playAudio(result.audioBase64, result.mimeType, version, speed);
        } catch {
          if (version !== requestVersion) return;
          await playLocal(cloudPieces.slice(i).join(" "));
          if (version === requestVersion) stopSpeechPlayback();
          return;
        }
        if (version !== requestVersion) return;
      }
    } else {
      await playLocalChunks(localChunks);
    }
    if (version === requestVersion) stopSpeechPlayback();
  } catch (error) {
    if (version === requestVersion) stopSpeechPlayback();
    throw error;
  }
}
