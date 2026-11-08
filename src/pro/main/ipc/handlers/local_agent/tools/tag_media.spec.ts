import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import { tagMediaTool } from "./tag_media";
import { readMediaMeta } from "@/ipc/utils/media_gallery_index";

describe("tag_media", () => {
  let app: string;
  beforeEach(async () => {
    app = await fs.mkdtemp(path.join(os.tmpdir(), "tagmedia-"));
    await fs.mkdir(path.join(app, ".dyad", "media"), { recursive: true });
    await fs.mkdir(path.join(app, "public", "library"), { recursive: true });
    await fs.writeFile(path.join(app, ".dyad", "media", "a.png"), "AAA");
    await fs.writeFile(path.join(app, ".dyad", "media", "b.png"), "BBB");
    await fs.writeFile(
      path.join(app, "public", "library", "copy-of-b.jpg"),
      "BBB",
    );
  });
  afterEach(async () => {
    await fs.rm(app, { recursive: true, force: true });
  });
  const run = (args: any) =>
    tagMediaTool.execute(args, { appPath: app } as any);

  it("sets section and pin by name or path, keeps other notes", async () => {
    const out = await run({
      files: ["a.png", ".dyad/media/b.png"],
      section: "Nyx",
      pinned: true,
    });
    expect(out).toContain("Tagged 2");
    const meta = await readMediaMeta(app);
    expect(meta["a.png"]).toEqual({ section: "Nyx", pinned: true });
    expect(meta["b.png"].section).toBe("Nyx");
  });

  it("finds the original of a library copy by content", async () => {
    await run({ files: ["public/library/copy-of-b.jpg"], section: "Muse" });
    const meta = await readMediaMeta(app);
    expect(meta["b.png"].section).toBe("Muse");
    expect(meta["a.png"]).toBeUndefined();
  });

  it("clears a section with an empty string and reports misses", async () => {
    await run({ files: ["a.png"], section: "Nyx", pinned: true });
    const out = await run({ files: ["a.png", "nope.png"], section: "" });
    expect(out).toContain("nope.png");
    const meta = await readMediaMeta(app);
    expect(meta["a.png"]).toEqual({ pinned: true });
  });

  it("refuses a call that changes nothing", async () => {
    await expect(run({ files: ["a.png"] })).rejects.toThrow();
  });
});
