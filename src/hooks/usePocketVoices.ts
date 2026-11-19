import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { POCKET_VOICES } from "@/shared/pocket_voices";

/**
 * Every Pocket voice the user can pick: the built-in ones, then the ones made
 * from sound files in the My voices folder. `refetch` re-reads the folder.
 */
export function usePocketVoices() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["pocket-voices"],
    queryFn: () => ipc.audio.listPocketVoices(),
    staleTime: 10_000,
  });
  const custom = data?.custom ?? [];
  const voices: ReadonlyArray<readonly [string, string]> = [
    ...POCKET_VOICES,
    ...custom.map((v) => [v.id, v.label] as const),
  ];
  return { voices, custom, folder: data?.folder ?? null, refetch, isFetching };
}
