import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ipc } from "@/ipc/types";
import { useOpenApp } from "@/hooks/useOpenApp";
import { useSettings } from "@/hooks/useSettings";
import {
  DEFAULT_TEMPERAMENT_INDEX,
  modelIgnoresTemperament,
  TEMPERAMENT_PRESETS,
  temperatureForPresetIndex,
} from "@/shared/temperament";
import { SisterBadge } from "@/components/SisterPicker";
import { cn } from "@/lib/utils";

const COLORS = [
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#a78bfa",
  "#f43f5e",
  "#0ea5e9",
  "#eab308",
  "#ec4899",
];

export function AddEntityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [personality, setPersonality] = useState("");
  const [temperamentIndex, setTemperamentIndex] = useState(
    DEFAULT_TEMPERAMENT_INDEX,
  );
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const openApp = useOpenApp();

  const create = useMutation({
    mutationFn: () => {
      const temperature = temperatureForPresetIndex(temperamentIndex);
      return ipc.chat.addEntity({
        name,
        color,
        personality,
        ...(temperature === undefined ? {} : { temperature }),
      });
    },
    onSuccess: async (sister) => {
      await queryClient.invalidateQueries({ queryKey: ["house", "sisters"] });
      await queryClient.invalidateQueries({ queryKey: ["apps"] });
      setName("");
      setPersonality("");
      setTemperamentIndex(DEFAULT_TEMPERAMENT_INDEX);
      onOpenChange(false);
      openApp(sister.appId);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="add-entity-dialog">
        <DialogHeader>
          <DialogTitle>Add an entity</DialogTitle>
          <DialogDescription>
            An entity is an AI crew member with its own room, memory and
            personality. It shows up in the left bar; click it to talk.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <SisterBadge
            color={color}
            initial={(name.trim()[0] ?? "?").toUpperCase()}
            size={40}
          />
          <Input
            autoFocus
            placeholder="Name (e.g. Professor Quill)"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            data-testid="add-entity-name"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "h-6 w-6 rounded-full border-2",
                color === c ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Textarea
          placeholder="Personality, in your own words (optional). e.g. A calm professor who explains things simply and loves a good metaphor."
          value={personality}
          rows={4}
          onChange={(e) => setPersonality(e.target.value)}
          data-testid="add-entity-personality"
        />
        <div className="space-y-1" data-testid="add-entity-temperament">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="add-entity-temperament-slider"
              className="text-sm font-medium"
            >
              Temperament
            </label>
            <span
              className="text-sm text-muted-foreground"
              data-testid="add-entity-temperament-label"
            >
              {TEMPERAMENT_PRESETS[temperamentIndex].label}
            </span>
          </div>
          <input
            id="add-entity-temperament-slider"
            data-testid="add-entity-temperament-slider"
            type="range"
            min={0}
            max={TEMPERAMENT_PRESETS.length - 1}
            step={1}
            value={temperamentIndex}
            aria-valuetext={TEMPERAMENT_PRESETS[temperamentIndex].label}
            onChange={(e) => setTemperamentIndex(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Straight-laced</span>
            <span>Wild</span>
          </div>
          <p className="text-xs text-muted-foreground">
            How wild or straight-laced this entity is. Default leaves it to the
            model.
          </p>
          {settings && modelIgnoresTemperament(settings.selectedModel) && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400"
              data-testid="add-entity-temperament-note"
            >
              The model selected right now ({settings.selectedModel.name})
              ignores temperament, so this will not change how this entity
              sounds until it is on a different model.
            </p>
          )}
        </div>
        {create.error && (
          <p className="text-sm text-red-500">{String(create.error.message)}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
            data-testid="add-entity-create"
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddEntityButton({ isExpanded }: { isExpanded: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Add an entity"
        title="Add an entity"
        data-testid="add-entity-button"
        onClick={() => setOpen(true)}
        className={cn(
          "mb-1 flex h-10 items-center justify-center rounded-xl text-sidebar-foreground/60 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          isExpanded ? "w-14" : "w-10",
        )}
      >
        <Plus size={20} />
      </button>
      <AddEntityDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
