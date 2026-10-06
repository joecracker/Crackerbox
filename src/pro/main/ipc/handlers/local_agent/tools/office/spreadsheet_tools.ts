import { z } from "zod";
import ExcelJS from "exceljs";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "../types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveInputFile, writeOutputFile } from "./office_utils";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function applyValue(
  cell: ExcelJS.Cell,
  value: string | number | boolean | null,
) {
  if (value === null) {
    cell.value = null;
  } else if (typeof value === "string" && value.startsWith("=")) {
    cell.value = { formula: value.slice(1) } as ExcelJS.CellFormulaValue;
  } else {
    cell.value = value;
  }
}

// ---------------------------------------------------------------------------
// write_spreadsheet — create a brand-new .xlsx
// ---------------------------------------------------------------------------

const writeSpreadsheetSchema = z.object({
  path: z
    .string()
    .describe("Output path relative to the app root, ending in .xlsx"),
  sheets: z
    .array(
      z.object({
        name: z.string().describe("Sheet tab name (max 31 characters)"),
        rows: z
          .array(z.array(cellValue))
          .describe(
            'Rows of cell values. A string starting with "=" becomes a live formula, e.g. "=SUM(B2:B10)".',
          ),
        header: z
          .boolean()
          .optional()
          .describe(
            "Style the first row as a bold, frozen header (default true).",
          ),
        column_widths: z
          .array(z.number())
          .optional()
          .describe("Optional column widths in characters."),
      }),
    )
    .min(1),
  description: z.string().optional(),
});

export const writeSpreadsheetTool: ToolDefinition<
  z.infer<typeof writeSpreadsheetSchema>
> = {
  name: "write_spreadsheet",
  description:
    'Create a new Excel workbook (.xlsx) from structured data. Each sheet is a list of rows; strings starting with "=" become live formulas. Overwrites an existing file at that path. To change an existing workbook while keeping its formatting, use edit_spreadsheet instead.',
  inputSchema: writeSpreadsheetSchema,
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",

  getConsentPreview: (args) => `Create spreadsheet ${args.path}`,

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    return `<dyad-write path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "Create spreadsheet")}"></dyad-write>`;
  },

  execute: async (args, ctx: AgentContext) => {
    if (!/\.xlsx$/i.test(args.path)) {
      throw new DyadError("Path must end in .xlsx", DyadErrorKind.Validation);
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = "Crackerbox";
    for (const sheet of args.sheets) {
      const ws = wb.addWorksheet(sheet.name.slice(0, 31));
      sheet.rows.forEach((row, r) => {
        row.forEach((value, c) => {
          applyValue(ws.getCell(r + 1, c + 1), value);
        });
      });
      if (sheet.header !== false && sheet.rows.length > 0) {
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: "frozen", ySplit: 1 }];
      }
      sheet.column_widths?.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const written = await writeOutputFile(ctx, args.path, buffer);
    return `Successfully wrote ${written} (${args.sheets.length} sheet(s))`;
  },
};

// ---------------------------------------------------------------------------
// edit_spreadsheet — change cells in an existing workbook
// ---------------------------------------------------------------------------

const editSpreadsheetSchema = z.object({
  path: z
    .string()
    .describe("Existing .xlsx: attachments:<name> or an app-relative path."),
  output_path: z
    .string()
    .optional()
    .describe(
      "Where to save the edited copy (app-relative). Required when path is an attachment; defaults to overwriting path otherwise.",
    ),
  edits: z
    .array(
      z.object({
        sheet: z.string().describe("Sheet name (created if it does not exist)"),
        cell: z.string().describe('Cell address such as "B7"'),
        value: cellValue.describe(
          'New value. A string starting with "=" is a formula. null clears the cell.',
        ),
      }),
    )
    .min(1),
  description: z.string().optional(),
});

export const editSpreadsheetTool: ToolDefinition<
  z.infer<typeof editSpreadsheetSchema>
> = {
  name: "edit_spreadsheet",
  description:
    "Change specific cells in an existing Excel workbook (.xlsx) while preserving its other sheets, formatting and formulas. Read it first with read_office_file to find the right cells. Attachments are never modified in place: give output_path to save the edited copy.",
  inputSchema: editSpreadsheetSchema,
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",

  getConsentPreview: (args) =>
    `Edit ${args.edits.length} cell(s) in ${args.output_path ?? args.path}`,

  buildXml: (args, _isComplete) => {
    const target = args.output_path ?? args.path;
    if (!target) return undefined;
    return `<dyad-write path="${escapeXmlAttr(target)}" description="${escapeXmlAttr(args.description ?? "Edit spreadsheet")}"></dyad-write>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const isAttachment = args.path.startsWith("attachments:");
    if (isAttachment && !args.output_path) {
      throw new DyadError(
        "Attachments cannot be modified in place. Provide output_path (for example data/edited.xlsx).",
        DyadErrorKind.Validation,
      );
    }
    const source = await resolveInputFile(ctx, args.path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(source);
    for (const edit of args.edits) {
      const ws =
        wb.getWorksheet(edit.sheet) ?? wb.addWorksheet(edit.sheet.slice(0, 31));
      applyValue(ws.getCell(edit.cell), edit.value);
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const written = await writeOutputFile(
      ctx,
      args.output_path ?? args.path,
      buffer,
    );
    return `Successfully updated ${args.edits.length} cell(s); saved to ${written}`;
  },
};
