import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePocketVoices } from "@/hooks/usePocketVoices";
import {
  TEMPERAMENT_PRESETS,
  presetIndexForTemperature,
  temperatureForPresetIndex,
} from "@/shared/temperament";

const NORMAL_VOICE = "normal";

/** Each entity's own voice and temperament. Changes save as soon as they are made. */
export function useHouseSisters() {
  return useQuery({
    queryKey: ["house", "sisters"],
    queryFn: () => ipc.chat.listSisters(),
  });
}

export const HOUSE_DESCRIPTION =
  "Each entity can have a voice of her own (spoken with Pocket) and a temperament. Entities with no voice use the voice chosen in Voice.";

/**
 * A helper that asks before every step keeps its own "Always allow" list.
 * Clicking Always allow in its chat adds a tool here. The list stays out of
 * sight: nothing shows until there is at least one rule, and then only a
 * closed line you can open. Remove puts that tool back on "ask" and leaves the
 * rest alone.
 */
function HelperRules({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ["house", "always", id],
    queryFn: () => ipc.chat.listEntityAlways({ id }),
  });
  const remove = async (toolName: string) => {
    const left = await ipc.chat.forgetEntityAlways({ id, toolName });
    queryClient.setQueryData(["house", "always", id], left);
  };
  if (!rules.data || rules.data.length === 0) return null;
  return (
    <details className="text-sm" data-testid={`house-rules-${id}`}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Always-allowed tools ({rules.data.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {rules.data.map((toolName) => (
          <li
            key={toolName}
            className="flex items-center justify-between gap-2 rounded border px-2 py-1"
          >
            <code className="text-xs">{toolName}</code>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Remove always allow for ${toolName}`}
              onClick={() => void remove(toolName)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function HouseSettings() {
  const queryClient = useQueryClient();
  const sisters = useHouseSisters();
  const pocketVoices = usePocketVoices();
  if (!sisters.data || sisters.data.length === 0) return null;

  const save = async (
    id: string,
    change: { voice?: string | null; temperature?: number | null },
  ) => {
    await ipc.chat.updateEntity({ id, ...change });
    await queryClient.invalidateQueries({ queryKey: ["house", "sisters"] });
  };

  return (
    <div className="space-y-3">
      {sisters.data.map((sister) => {
        const index = presetIndexForTemperature(sister.temperature);
        return (
          <div
            key={sister.id}
            className="space-y-2 rounded-md border p-3"
            data-testid={`house-entity-${sister.id}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-20 text-sm font-medium">
                {sister.name}
              </span>
              <Select
                value={sister.voice ?? NORMAL_VOICE}
                onValueChange={(value) =>
                  void save(sister.id, {
                    voice: value === NORMAL_VOICE ? null : value,
                  })
                }
              >
                <SelectTrigger className="min-w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NORMAL_VOICE}>Normal voice</SelectItem>
                  {pocketVoices.voices.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">
                  Temperament
                </span>
                <span className="text-xs text-muted-foreground">
                  {TEMPERAMENT_PRESETS[index].label}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={TEMPERAMENT_PRESETS.length - 1}
                step={1}
                value={index}
                aria-label={`${sister.name} temperament`}
                aria-valuetext={TEMPERAMENT_PRESETS[index].label}
                onChange={(e) =>
                  void save(sister.id, {
                    temperature:
                      temperatureForPresetIndex(Number(e.target.value)) ?? null,
                  })
                }
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Straight-laced</span>
                <span>Wild</span>
              </div>
            </div>
            {sister.askEveryStep && <HelperRules id={sister.id} />}
          </div>
        );
      })}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Some models (GPT-5 and newer, ChatGPT subscription, Claude Code) ignore
        temperament.
      </p>
    </div>
  );
}
