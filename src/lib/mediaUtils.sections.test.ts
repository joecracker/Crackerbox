import { describe, expect, it } from "vitest";
import {
  UNSORTED_SECTION,
  fileMatchesQuery,
  fileMatchesSection,
  filterMediaAppsByQuery,
  formatBytes,
  getSectionCounts,
} from "./mediaUtils";

describe("sections and search", () => {
  const files = [
    { fileName: "a.png", section: "characters", prompt: "a red barn" },
    { fileName: "b.png", section: "Backgrounds" },
    { fileName: "c.png", section: "characters" },
    { fileName: "d.png" },
  ];

  it("counts sections A to Z", () => {
    expect(getSectionCounts(files)).toEqual([
      { section: "Backgrounds", count: 1 },
      { section: "characters", count: 2 },
    ]);
  });

  it("filters by section and by unsorted", () => {
    expect(files.filter((f) => fileMatchesSection(f, "")).length).toBe(4);
    expect(
      files.filter((f) => fileMatchesSection(f, "characters")).length,
    ).toBe(2);
    expect(
      files.filter((f) => fileMatchesSection(f, UNSORTED_SECTION)),
    ).toEqual([{ fileName: "d.png" }]);
  });

  it("searches name, section and prompt", () => {
    expect(fileMatchesQuery(files[0], "barn")).toBe(true);
    expect(fileMatchesQuery(files[1], "backg")).toBe(true);
    expect(fileMatchesQuery(files[3], "barn")).toBe(false);
    expect(fileMatchesQuery(files[3], "  ")).toBe(true);
    expect(
      filterMediaAppsByQuery([{ appName: "x", files }], "barn"),
    ).toHaveLength(1);
    expect(
      filterMediaAppsByQuery([{ appName: "x", files: [files[3]] }], "barn"),
    ).toHaveLength(0);
  });

  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
  });
});
