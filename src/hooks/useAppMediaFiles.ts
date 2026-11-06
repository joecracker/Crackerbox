import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ipc,
  type RenameMediaFileParams,
  type DeleteMediaFileParams,
  type MoveMediaFileParams,
  type UpdateMediaMetaParams,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { useSettings } from "./useSettings";

export function useAppMediaFiles() {
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  const query = useQuery({
    queryKey: queryKeys.media.all,
    queryFn: () => ipc.media.listAllMedia(),
    // Media files can be added externally (e.g., via file system), so keep
    // staleTime short to pick up new files promptly.
    staleTime: settings?.isTestMode ? 0 : 10_000,
  });

  const storageQuery = useQuery({
    queryKey: queryKeys.media.storage,
    queryFn: () => ipc.media.getMediaStorageInfo(),
    staleTime: settings?.isTestMode ? 0 : 10_000,
  });

  const renameMutation = useMutation({
    mutationFn: (params: RenameMediaFileParams) => {
      return ipc.media.renameMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Renamed image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (params: DeleteMediaFileParams) => {
      return ipc.media.deleteMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Deleted image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  const moveMutation = useMutation({
    mutationFn: (params: MoveMediaFileParams) => {
      return ipc.media.moveMediaFile(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      showSuccess(`Moved image "${params.fileName}"`);
    },
    onError: (error) => {
      showError(error);
    },
  });

  const metaMutation = useMutation({
    mutationFn: (params: UpdateMediaMetaParams) => {
      return ipc.media.updateMediaMeta(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    },
    onError: (error) => {
      showError(error);
    },
  });

  return {
    mediaApps: query.data?.apps ?? [],
    storageInfo: storageQuery.data,
    isLoading: query.isLoading,
    renameMediaFile: renameMutation.mutateAsync,
    deleteMediaFile: deleteMutation.mutateAsync,
    moveMediaFile: moveMutation.mutateAsync,
    updateMediaMeta: metaMutation.mutateAsync,
    isMutatingMedia:
      renameMutation.isPending ||
      deleteMutation.isPending ||
      moveMutation.isPending ||
      metaMutation.isPending,
  };
}
