import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLET_SIZE,
  fitScale,
  tabletSizeFromSettings,
} from "./previewDevice";

describe("tabletSizeFromSettings", () => {
  it("uses the default when nothing is set", () => {
    expect(tabletSizeFromSettings(undefined)).toEqual(DEFAULT_TABLET_SIZE);
    expect(tabletSizeFromSettings({})).toEqual(DEFAULT_TABLET_SIZE);
  });

  it("uses the saved landscape size", () => {
    expect(
      tabletSizeFromSettings({
        previewTabletWidth: 1340,
        previewTabletHeight: 800,
      }),
    ).toEqual({ width: 1340, height: 800 });
  });

  it("ignores values that are out of range or not whole numbers", () => {
    expect(
      tabletSizeFromSettings({
        previewTabletWidth: 50,
        previewTabletHeight: 800.5,
      }),
    ).toEqual(DEFAULT_TABLET_SIZE);
  });
});

describe("fitScale", () => {
  const tablet = { width: 1280, height: 800 };

  it("shrinks the frame to fit the narrower side", () => {
    expect(fitScale({ width: 640, height: 2000 }, tablet)).toBe(0.5);
    expect(fitScale({ width: 2000, height: 400 }, tablet)).toBe(0.5);
  });

  it("never enlarges the frame", () => {
    expect(fitScale({ width: 3000, height: 3000 }, tablet)).toBe(1);
  });

  it("does not shrink to nothing before the space has been measured", () => {
    expect(fitScale({ width: 0, height: 0 }, tablet)).toBe(1);
  });
});
