import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/ipc/types";
import {
  isCustomVoiceName,
  MAX_CUSTOM_VOICE_NAME,
} from "@/shared/pocket_voices";
import { showError, showSuccess } from "@/lib/toast";
import { recordingToWav } from "@/lib/wav_audio";

const MAX_RECORD_SECONDS = 30;
const TRY_IT_TEXT = "Hello, this is my new voice. How does it sound?";

type Voices = {
  custom: ReadonlyArray<{ id: string; label: string }>;
  refetch: () => unknown;
  isFetching: boolean;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Make a voice of your own: type a name, press Record, talk for 10 to 30
 * seconds, press Stop. The recording is turned into a voice in the My voices
 * folder, with nothing else to do. A sound file you already have works too.
 */
export function MyVoicesPanel({ voices }: { voices: Voices }) {
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunks = useRef<Blob[]>([]);
  const nameAtStart = useRef("");
  const player = useRef<HTMLAudioElement | null>(null);

  const cleanName = name.trim();
  const nameOk = isCustomVoiceName(cleanName);
  const nameTaken = voices.custom.some(
    (v) => v.id.toLowerCase() === `custom:${cleanName}`.toLowerCase(),
  );

  const stopTracks = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      stopTracks();
      player.current?.pause();
    },
    [],
  );

  const save = async (
    bytes: Uint8Array<ArrayBuffer>,
    extension: string,
    voiceName: string,
  ) => {
    setBusy(true);
    try {
      const made = await ipc.audio.createPocketVoice({
        name: voiceName,
        extension,
        audioData: bytes,
      });
      await voices.refetch();
      setName("");
      showSuccess(
        `${made.label} is ready. Pick it under Voice, or press Try it.`,
      );
    } catch (error) {
      showError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (!nameOk || nameTaken) return;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch {
      showError(
        "Crackerbox could not use the microphone. Check that a microphone is plugged in and allowed.",
      );
      return;
    }
    nameAtStart.current = cleanName;
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    recorder.current = rec;
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    rec.onstop = () => {
      stopTracks();
      setRecording(false);
      const blob = new Blob(chunks.current, { type: rec.mimeType });
      void (async () => {
        try {
          const wav = await recordingToWav(blob);
          await save(wav, ".wav", nameAtStart.current);
        } catch (error) {
          showError(`Could not read that recording: ${errorText(error)}`);
        }
      })();
    };
    rec.start();
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      setSeconds((value) => {
        if (value + 1 >= MAX_RECORD_SECONDS) stopRecording();
        return value + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop();
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file || !nameOk || nameTaken) return;
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf("."))
      : "";
    await save(new Uint8Array(await file.arrayBuffer()), extension, cleanName);
  };

  const tryIt = async (id: string) => {
    setBusy(true);
    try {
      const result = await ipc.audio.synthesizeSpeech({
        text: TRY_IT_TEXT,
        voice: id,
        speed: 1,
        provider: "pocket",
      });
      player.current?.pause();
      const audio = new Audio(
        `data:${result.mimeType};base64,${result.audioBase64}`,
      );
      player.current = audio;
      await audio.play();
    } catch (error) {
      showError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Remove ${label}? This deletes the voice and its recording.`,
      )
    ) {
      return;
    }
    try {
      await ipc.audio.deletePocketVoice({ id });
      await voices.refetch();
    } catch (error) {
      showError(errorText(error));
    }
  };

  const hint = !cleanName
    ? "Type a name for the voice first."
    : !nameOk
      ? `Pick a shorter name (up to ${MAX_CUSTOM_VOICE_NAME} letters) without \\ / : * ? " < > |`
      : nameTaken
        ? "You already have a voice with that name."
        : null;

  return (
    <div className="space-y-3" data-testid="my-voices">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">My voices</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void ipc.audio
              .openPocketVoicesFolder()
              .then(() => voices.refetch())
              .catch((error) => showError(errorText(error)))
          }
        >
          Open folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={voices.isFetching}
          onClick={() => void voices.refetch()}
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          placeholder="Name for the new voice"
          aria-label="Name for the new voice"
          value={name}
          maxLength={MAX_CUSTOM_VOICE_NAME}
          disabled={recording || busy}
          onChange={(event) => setName(event.target.value)}
        />
        {recording ? (
          <Button size="sm" variant="destructive" onClick={stopRecording}>
            Stop and make the voice ({seconds}s)
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!nameOk || nameTaken || busy}
            onClick={() => void startRecording()}
          >
            {busy ? "Making the voice..." : "Record"}
          </Button>
        )}
        <label
          className={`text-sm underline ${
            !nameOk || nameTaken || busy || recording
              ? "pointer-events-none opacity-50"
              : "cursor-pointer"
          }`}
        >
          or choose a recording
          <input
            type="file"
            accept=".wav,.flac,.mp3,.ogg"
            className="hidden"
            disabled={!nameOk || nameTaken || busy || recording}
            onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {hint && !recording && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Press Record and talk naturally for 10 to 30 seconds, in a quiet room,
        as one person. Press Stop and the voice is made and added here. Use
        voices you have the right to use.
      </p>

      {voices.custom.length > 0 && (
        <ul className="space-y-1">
          {voices.custom.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="min-w-40">{v.label}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void tryIt(v.id)}
              >
                Try it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void remove(v.id, v.label)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
