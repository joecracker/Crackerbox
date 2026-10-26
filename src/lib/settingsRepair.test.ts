import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseSettingsWithRepair } from "./settingsRepair";

const schema = z
  .object({
    speechProvider: z.enum(["openrouter", "local"]).optional(),
    enableAutoUpdate: z.boolean(),
    providerSettings: z
      .record(
        z.string(),
        z.object({
          apiKey: z.object({ value: z.string() }).optional(),
          mode: z.enum(["a", "b"]).optional(),
        }),
      )
      .optional(),
    tags: z.array(z.enum(["x", "y"])).optional(),
  })
  .passthrough();

const defaults = { speechProvider: "openrouter", enableAutoUpdate: true };

describe("parseSettingsWithRepair", () => {
  it("returns valid settings unchanged", () => {
    const data = { speechProvider: "local", enableAutoUpdate: false };
    expect(parseSettingsWithRepair(schema, data, defaults)).toEqual(data);
  });

  it("resets only the unknown choice and keeps every other setting", () => {
    const warn = vi.fn();
    const data = {
      speechProvider: "venice",
      enableAutoUpdate: false,
      providerSettings: { venice: { apiKey: { value: "k" } } },
      futureSetting: "kept",
    };
    expect(parseSettingsWithRepair(schema, data, defaults, warn)).toEqual({
      speechProvider: "openrouter",
      enableAutoUpdate: false,
      providerSettings: { venice: { apiKey: { value: "k" } } },
      futureSetting: "kept",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"speechProvider"'),
    );
    // The caller's object is left alone.
    expect(data.speechProvider).toBe("venice");
  });

  it("drops a bad value deeper down without losing its neighbours", () => {
    const data = {
      enableAutoUpdate: true,
      providerSettings: { one: { apiKey: { value: "k" }, mode: "zzz" } },
    };
    expect(parseSettingsWithRepair(schema, data, defaults)).toEqual({
      enableAutoUpdate: true,
      providerSettings: { one: { apiKey: { value: "k" } } },
    });
  });

  it("fills a missing required setting from the defaults", () => {
    expect(parseSettingsWithRepair(schema, {}, defaults)).toEqual({
      enableAutoUpdate: true,
    });
  });

  it("still throws when a value cannot be repaired", () => {
    expect(() =>
      parseSettingsWithRepair(
        schema,
        { enableAutoUpdate: true, tags: ["x", "nope"] },
        defaults,
      ),
    ).toThrow();
  });
});
