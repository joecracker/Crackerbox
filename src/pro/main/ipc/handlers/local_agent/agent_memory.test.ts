import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => h.userData }));

import {
  agentMemoryDir,
  agentMemoryPromptBlock,
  deleteAgentMemory,
  listTopicFiles,
  MAX_TOPICS,
  MEMORY_LIMITS,
  memoryIndexText,
  normalizeMemoryName,
  readMemoryFile,
  updateMemory,
} from "./agent_memory";

const APP = 7;
const DAY = new Date("2026-10-30T12:00:00Z");

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-memory-"));
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("file names", () => {
  it("accepts core and topic names and tolerates .md and topics/", () => {
    expect(normalizeMemoryName("State")).toBe("state");
    expect(normalizeMemoryName("topics/red-batch.md")).toBe("red-batch");
  });
  it("rejects anything that could leave the cabinet", () => {
    for (const bad of [
      "../x",
      "a/b",
      "..",
      "",
      "x y",
      "C:\\evil",
      "a".repeat(41),
    ])
      expect(() => normalizeMemoryName(bad)).toThrow();
  });
});

describe("append", () => {
  it("adds to the end and keeps what was there", () => {
    updateMemory(APP, { file: "facts", mode: "append", text: "- one" }, DAY);
    updateMemory(APP, { file: "facts", mode: "append", text: "- two" }, DAY);
    expect(readMemoryFile(APP, "facts")).toBe("- one\n- two");
  });
  it("dates every decision and does not double-date", () => {
    updateMemory(
      APP,
      {
        file: "decisions",
        mode: "append",
        text: "Muse test is out\n- [2026-10-01] no cloud",
      },
      DAY,
    );
    expect(readMemoryFile(APP, "decisions")).toBe(
      "- [2026-10-30] Muse test is out\n- [2026-10-01] no cloud",
    );
  });
  it("refuses empty text", () => {
    expect(() =>
      updateMemory(APP, { file: "facts", mode: "append", text: "  " }),
    ).toThrow();
  });
});

describe("replace_section", () => {
  const base = "## A\na1\n\n## B\nb1\nb2\n\n### B-sub\nsub\n\n## C\nc1";
  beforeEach(() => {
    updateMemory(APP, { file: "facts", mode: "replace_file", text: base });
  });
  it("rewrites only the named section and keeps its sub-sections out of the way of others", () => {
    updateMemory(APP, {
      file: "facts",
      mode: "replace_section",
      heading: "## B",
      text: "new b",
    });
    expect(readMemoryFile(APP, "facts")).toBe(
      "## A\na1\n\n## B\nnew b\n\n## C\nc1",
    );
  });
  it("adds a missing section at the end", () => {
    updateMemory(APP, {
      file: "facts",
      mode: "replace_section",
      heading: "## D",
      text: "d1",
    });
    expect(readMemoryFile(APP, "facts")).toBe(`${base}\n\n## D\nd1`);
  });
  it("removes a section when the text is empty", () => {
    updateMemory(APP, {
      file: "facts",
      mode: "replace_section",
      heading: "## A",
      text: "",
    });
    expect(readMemoryFile(APP, "facts").startsWith("## B")).toBe(true);
  });
  it("needs a real heading", () => {
    expect(() =>
      updateMemory(APP, {
        file: "facts",
        mode: "replace_section",
        heading: "B",
        text: "x",
      }),
    ).toThrow(/heading/);
  });
});

describe("limits and safety", () => {
  it("refuses an over-size write and saves nothing", () => {
    updateMemory(APP, { file: "state", mode: "replace_file", text: "keep me" });
    expect(() =>
      updateMemory(APP, {
        file: "state",
        mode: "replace_file",
        text: "x".repeat(MEMORY_LIMITS.state + 1),
      }),
    ).toThrow(/limit/);
    expect(readMemoryFile(APP, "state")).toBe("keep me");
  });
  it("append past the limit moves the oldest decision lines to an archive topic", () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `- [2026-10-01] ruling ${i} ${"d".repeat(90)}`,
    );
    updateMemory(APP, {
      file: "decisions",
      mode: "replace_file",
      text: lines.join("\n"),
    });
    const result = updateMemory(
      APP,
      {
        file: "decisions",
        mode: "append",
        text: "newest ruling " + "n".repeat(500),
      },
      DAY,
    );
    expect(result).toMatch(
      /Moved the \d+ oldest line\(s\) to topics\/decisions-archive/,
    );
    const kept = readMemoryFile(APP, "decisions");
    expect(kept.length).toBeLessThanOrEqual(MEMORY_LIMITS.decisions);
    expect(kept).toContain("newest ruling");
    expect(kept).not.toContain(lines[0]);
    expect(readMemoryFile(APP, "decisions-archive")).toContain(lines[0]);
    expect(listTopicFiles(APP)).toContain("decisions-archive");
  });
  it("replace_file past the limit is still refused (she asked for that exact text)", () => {
    expect(() =>
      updateMemory(APP, {
        file: "facts",
        mode: "replace_file",
        text: "x".repeat(MEMORY_LIMITS.facts + 1),
      }),
    ).toThrow(/limit/);
  });
  it("caps the number of topic files", () => {
    for (let i = 0; i < MAX_TOPICS; i++)
      updateMemory(APP, {
        file: `t${i}`,
        mode: "replace_file",
        text: `# topic ${i}`,
      });
    expect(() =>
      updateMemory(APP, {
        file: "one-too-many",
        mode: "replace_file",
        text: "# x",
      }),
    ).toThrow(/topic files/);
    // Editing an existing topic still works at the cap.
    expect(() =>
      updateMemory(APP, { file: "t0", mode: "append", text: "more" }),
    ).not.toThrow();
  });
  it("leaves no temp file behind", () => {
    updateMemory(APP, { file: "state", mode: "replace_file", text: "a" });
    expect(fs.readdirSync(agentMemoryDir(APP))).toEqual(["state.md"]);
  });
  it("clearing a file removes it", () => {
    updateMemory(APP, { file: "state", mode: "replace_file", text: "a" });
    expect(
      updateMemory(APP, { file: "state", mode: "replace_file", text: "" }),
    ).toMatch(/Cleared/);
    expect(readMemoryFile(APP, "state")).toBe("");
  });
});

describe("prompt block and index", () => {
  it("lists every file and shows the three core files, empty or not", () => {
    updateMemory(
      APP,
      { file: "decisions", mode: "append", text: "no Muse" },
      DAY,
    );
    updateMemory(APP, {
      file: "red-batch",
      mode: "replace_file",
      text: "# The red batch of sheets\ndetails",
    });
    const block = agentMemoryPromptBlock(APP);
    expect(block).toContain("## Your memory for this app");
    expect(block).toContain("### state\n(empty)");
    expect(block).toContain("### decisions\n- [2026-10-30] no Muse");
    expect(block).toContain("### facts\n(empty)");
    expect(block).toContain("topics/red-batch");
    expect(block).toContain("The red batch of sheets");
    // Topic bodies are not loaded, only indexed.
    expect(block).not.toContain("details");
    expect(listTopicFiles(APP)).toEqual(["red-batch"]);
    expect(memoryIndexText(APP)).toContain("- state (empty)");
  });
  it("keeps apps apart", () => {
    updateMemory(1, { file: "facts", mode: "append", text: "one" });
    updateMemory(2, { file: "facts", mode: "append", text: "two" });
    expect(readMemoryFile(1, "facts")).toBe("one");
    expect(readMemoryFile(2, "facts")).toBe("two");
  });
});

describe("deleteAgentMemory", () => {
  it("removes the whole cabinet and never throws", () => {
    updateMemory(APP, { file: "facts", mode: "append", text: "x" });
    deleteAgentMemory(APP);
    expect(fs.existsSync(agentMemoryDir(APP))).toBe(false);
    expect(() => deleteAgentMemory(APP)).not.toThrow();
  });
});
