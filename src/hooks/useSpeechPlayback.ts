import { useEffect, useState } from "react";
import {
  subscribeToSpeechPlayback,
  type SpeechPlaybackState,
} from "@/lib/speechPlayback";

const INITIAL_STATE: SpeechPlaybackState = { messageId: null, status: "idle" };

export function useSpeechPlayback() {
  const [state, setState] = useState<SpeechPlaybackState>(INITIAL_STATE);

  useEffect(() => subscribeToSpeechPlayback(setState), []);
  return state;
}
