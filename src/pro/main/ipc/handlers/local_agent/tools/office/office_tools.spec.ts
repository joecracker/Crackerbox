import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../types";
import { readOfficeFileTool } from "./read_office_file";
import { writeSpreadsheetTool, editSpreadsheetTool } from "./spreadsheet_tools";
import {
  convertOfficeFileTool,
  writeDocumentTool,
  writePresentationTool,
} from "./document_tools";

describe("office tools round trip", () => {
  let appPath: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "office-tools-"));
    ctx = { appPath, appId: 1 } as AgentContext;
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("does not count office or PDF work as a code mutation", () => {
    expect([
      readOfficeFileTool,
      writeSpreadsheetTool,
      editSpreadsheetTool,
      writeDocumentTool,
      writePresentationTool,
      convertOfficeFileTool,
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mutationTracking: "none" }),
      ]),
    );
    for (const tool of [
      readOfficeFileTool,
      writeSpreadsheetTool,
      editSpreadsheetTool,
      writeDocumentTool,
      writePresentationTool,
      convertOfficeFileTool,
    ]) {
      expect(tool.mutationTracking).toBe("none");
    }
  });

  it("refuses office files over the size limit", async () => {
    await fs.writeFile(
      path.join(appPath, "huge.xlsx"),
      Buffer.alloc(26 * 1024 * 1024),
    );
    await expect(
      readOfficeFileTool.execute({ path: "huge.xlsx" }, ctx),
    ).rejects.toThrow(/too large/);
  });
  it("writes, edits and reads a spreadsheet with formulas", async () => {
    await writeSpreadsheetTool.execute(
      {
        path: "data/prices.xlsx",
        sheets: [
          {
            name: "Prices",
            rows: [
              ["Item", "Qty", "Cost"],
              ["Lumber", 4, 12.5],
              ["Nails", 10, 0.2],
              ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)"],
            ],
          },
        ],
      },
      ctx,
    );
    await editSpreadsheetTool.execute(
      {
        path: "data/prices.xlsx",
        edits: [{ sheet: "Prices", cell: "A2", value: "Framing lumber" }],
      },
      ctx,
    );
    const text = await readOfficeFileTool.execute(
      { path: "data/prices.xlsx" },
      ctx,
    );
    expect(text).toContain("Framing lumber");
    expect(text).toContain("=SUM(B2:B3)");
    expect(text).toContain('Sheet "Prices"');
  });

  it("writes and reads a Word document", async () => {
    await writeDocumentTool.execute(
      {
        path: "docs/proposal.docx",
        title: "Kitchen Remodel",
        blocks: [
          { type: "heading", level: 1, text: "Scope" },
          { type: "paragraph", text: "Replace **all** cabinets." },
          { type: "bullets", items: ["Demo", "Install"] },
          {
            type: "table",
            header: ["Phase", "Cost"],
            rows: [["Demo", "$500"]],
          },
        ],
      },
      ctx,
    );
    const text = await readOfficeFileTool.execute(
      { path: "docs/proposal.docx" },
      ctx,
    );
    expect(text).toContain("Kitchen Remodel");
    expect(text).toContain("Replace");
    expect(text).toContain("Demo");
    expect(text).toContain("$500");
  });

  it("writes and reads a PowerPoint deck with notes", async () => {
    await writePresentationTool.execute(
      {
        path: "decks/pitch.pptx",
        slides: [
          {
            title: "Why us",
            bullets: ["Fast", "Fair"],
            notes: "Smile here",
          },
        ],
      },
      ctx,
    );
    const text = await readOfficeFileTool.execute(
      { path: "decks/pitch.pptx" },
      ctx,
    );
    expect(text).toContain("Why us");
    expect(text).toContain("Fast");
    expect(text).toContain("Smile here");
  });
});
