import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";

/**
 * Folders outside a project where she may change files without asking (the
 * user answered "Always allow" for them). Each one can be taken away here.
 */
export function TrustedFoldersSetting() {
  const { settings, updateSettings } = useSettings();
  if (!settings) return null;
  const folders = settings.trustedHostFolders ?? [];

  return (
    <div className="space-y-1.5" data-testid="trusted-folders">
      <p className="text-sm font-medium">
        Folders she may change without asking
      </p>
      {folders.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None yet. When she asks to change a file outside a project and you
          choose "Always allow", that folder shows up here.
        </p>
      ) : (
        <ul className="space-y-1">
          {folders.map((folder) => (
            <li
              key={folder}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <code className="break-all">{folder}</code>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() =>
                  updateSettings({
                    trustedHostFolders: folders.filter((f) => f !== folder),
                  })
                }
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
