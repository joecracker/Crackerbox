import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POCKET_VOICES } from "@/shared/pocket_voices";
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

export function HouseSettings() {
  const queryClient = useQueryClient();
  const sisters = useHouseSisters();
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
                  {POCKET_VOICES.map(([id, label]) => (
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
