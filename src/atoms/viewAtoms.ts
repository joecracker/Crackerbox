import { atom } from "jotai";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";

export const isPreviewOpenAtom = atom(false);
export const isChatPanelHiddenAtom = atom(false);
export const selectedFileAtom = atom<{
  path: string;
  line?: number | null;
} | null>(null);
export const editorCursorAtom = atom<{
  appId: number | null;
  path: string;
  lineNumber: number;
  column: number;
} | null>(null);
// When set, the code view shows the working-tree diff (vs HEAD) for this
// staged file instead of the file tree + editor. Cleared to return to editing.
export const stagedDiffFileAtom = atom<string | null>(null);

/**
 * Files whose editor buffer differs from disk, so surfaces outside the editor
 * (the file tree) can mark them as unsaved.
 *
 * Keyed by editor instance rather than by path: `FileEditor` is mounted both in
 * the code view and inside chat write cards, and both can target the same file.
 * Instance keys make unmount cleanup naturally refcounted, so one editor closing
 * cannot clear a sibling editor's dirty flag.
 */
export const unsavedEditorFilesAtom = atom<
  Map<string, { appId: number; filePath: string }>
>(new Map());

export const setUnsavedEditorFileAtom = atom(
  null,
  (
    get,
    set,
    {
      editorId,
      appId,
      filePath,
      unsaved,
    }: {
      editorId: string;
      appId: number | null;
      filePath: string;
      unsaved: boolean;
    },
  ) => {
    const current = get(unsavedEditorFilesAtom);
    const existing = current.get(editorId);
    if (!unsaved || appId === null) {
      // Keep the map reference stable when there is nothing to remove, so
      // subscribers don't rerender on every clean render of every editor.
      if (!existing) return;
      const next = new Map(current);
      next.delete(editorId);
      set(unsavedEditorFilesAtom, next);
      return;
    }
    if (existing?.appId === appId && existing.filePath === filePath) return;
    const next = new Map(current);
    next.set(editorId, { appId, filePath });
    set(unsavedEditorFilesAtom, next);
  },
);
export const activeSettingsSectionAtom = atom<string | null>(
  SECTION_IDS.general,
);

const SETTINGS_OPEN_KEY = "cb-settings-open-sections";
/** Every settings section starts folded; opening one is remembered. */
const SETTINGS_DEFAULT_OPEN: Record<string, boolean> = {};

function readSettingsOpenSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SETTINGS_OPEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Storage can be blocked or hold junk; fall back to the defaults.
  }
  return {};
}

/** Only the sections the user has opened or closed by hand; the rest use the defaults. */
export const settingsOpenSectionsAtom = atom<Record<string, boolean>>(
  readSettingsOpenSections(),
);

export function isSettingsSectionOpen(
  overrides: Record<string, boolean>,
  id: string,
): boolean {
  return overrides[id] ?? SETTINGS_DEFAULT_OPEN[id] ?? false;
}

export const setSettingsSectionOpenAtom = atom(
  null,
  (get, set, update: { id: string; open: boolean }) => {
    const next = {
      ...get(settingsOpenSectionsAtom),
      [update.id]: update.open,
    };
    set(settingsOpenSectionsAtom, next);
    try {
      localStorage.setItem(SETTINGS_OPEN_KEY, JSON.stringify(next));
    } catch {
      // Not remembering the choice is fine.
    }
  },
);
