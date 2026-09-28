import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  WORKSPACE_COLOR_FIELDS,
  WORKSPACE_COLOR_FALLBACKS,
  WORKSPACE_COLOR_PRESETS,
  type WorkspaceColorKey,
} from "@/lib/workspaceColors";

const HUES = [0, 20, 40, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const LIGHTNESS = [82, 68, 54, 42, 32, 22];
const GRAYS = [
  "#ffffff",
  "#d8d8d8",
  "#a8a8a8",
  "#777777",
  "#454545",
  "#111111",
];

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = l - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${[r, g, b]
    .map((value) =>
      Math.round((value + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hexToHsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation =
    chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma !== 0) {
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
  };
}

export function WorkspaceColorSettings() {
  const { isDarkMode, workspaceColors, setWorkspaceColor, setWorkspaceColors } =
    useTheme();
  const [selected, setSelected] = useState<WorkspaceColorKey>("chat");
  const fallback = WORKSPACE_COLOR_FALLBACKS[isDarkMode ? "dark" : "light"];
  const selectedColor =
    workspaceColors[selected] ?? fallback[selected] ?? "#ffffff";
  const [hexDraft, setHexDraft] = useState(selectedColor);
  const fineTune = hexToHsl(selectedColor);

  useEffect(() => {
    setHexDraft(selectedColor.toUpperCase());
  }, [selectedColor]);

  const saveHex = () => {
    const value = hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`;
    if (/^#[0-9a-f]{6}$/i.test(value))
      setWorkspaceColor(selected, value.toLowerCase());
    else setHexDraft(selectedColor.toUpperCase());
  };

  return (
    <div className="space-y-5 border-t border-border/60 pt-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Workspace colors
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a starting mood, then change any part independently. Changes
          appear immediately on this device.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(WORKSPACE_COLOR_PRESETS).map(([name, colors]) => (
          <button
            key={name}
            type="button"
            onClick={() => setWorkspaceColors(colors)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setWorkspaceColors({})}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Reset all
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {WORKSPACE_COLOR_FIELDS.map((field) => (
            <button
              key={field.key}
              type="button"
              onClick={() => setSelected(field.key)}
              aria-pressed={selected === field.key}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${selected === field.key ? "border-foreground/40 bg-muted text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground"}`}
            >
              <span
                className="size-4 shrink-0 rounded border border-white/25"
                style={{
                  backgroundColor:
                    workspaceColors[field.key] ?? fallback[field.key],
                }}
              />
              {field.label}
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          <h4 className="text-xs font-medium text-foreground">
            Fine-tune{" "}
            {WORKSPACE_COLOR_FIELDS.find(
              (field) => field.key === selected,
            )?.label.toLowerCase()}
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="relative size-9 overflow-hidden rounded-md border border-border"
              aria-label="Open full color picker"
            >
              <input
                type="color"
                aria-label="Open full color picker"
                value={selectedColor}
                onChange={(event) =>
                  setWorkspaceColor(selected, event.target.value)
                }
                className="absolute -inset-2 h-14 w-14 cursor-pointer"
              />
            </label>
            <input
              type="text"
              aria-label="Hex color"
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={saveHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-24 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            />
            <button
              type="button"
              onClick={() => setWorkspaceColor(selected, null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Reset this color
            </button>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            {(
              [
                ["Hue", "hue", 359],
                ["Vividness", "saturation", 100],
                ["Shade", "lightness", 100],
              ] as const
            ).map(([label, channel, max]) => (
              <label key={channel} className="flex min-w-0 flex-col gap-1">
                <span>
                  {label}: {fineTune[channel]}
                  {channel === "hue" ? "°" : "%"}
                </span>
                <input
                  type="range"
                  min={0}
                  max={max}
                  value={fineTune[channel]}
                  onChange={(event) => {
                    const next = {
                      ...fineTune,
                      [channel]: Number(event.target.value),
                    };
                    if (channel === "hue" && next.saturation === 0)
                      next.saturation = 42;
                    setWorkspaceColor(
                      selected,
                      hslToHex(next.hue, next.saturation, next.lightness),
                    );
                  }}
                  className="w-full accent-[#879b78]"
                />
              </label>
            ))}
          </div>

          <div className="overflow-x-auto pb-1">
            <div
              className="grid w-max grid-cols-[repeat(14,1.45rem)] gap-1"
              aria-label="Color shade palette"
            >
              {LIGHTNESS.map((lightness, row) => (
                <div key={lightness} className="contents">
                  <button
                    type="button"
                    title={`Gray shade ${row + 1}`}
                    aria-label={`Gray shade ${row + 1}`}
                    onClick={() => setWorkspaceColor(selected, GRAYS[row])}
                    className="size-[1.45rem] rounded-[3px] border border-white/10"
                    style={{ backgroundColor: GRAYS[row] }}
                  />
                  {HUES.map((hue) => {
                    const color = hslToHex(hue, 42, lightness);
                    return (
                      <button
                        key={`${hue}-${lightness}`}
                        type="button"
                        title={color}
                        aria-label={`Color ${color}`}
                        onClick={() => setWorkspaceColor(selected, color)}
                        className="size-[1.45rem] rounded-[3px] border border-white/10"
                        style={{ backgroundColor: color }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Choose a swatch, drag the controls for precision, or enter an exact
            hex color.
          </p>
        </div>
      </div>
    </div>
  );
}
