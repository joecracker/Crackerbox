import fsp from "node:fs/promises";
import { z } from "zod";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "../types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  convertWithLibreOffice,
  decodeXmlEntities,
  extOf,
  resolveInputFile,
} from "./office_utils";

const OUTPUT_LIMIT_CHARS = 200_000;
const TRUNCATION_NOTICE =
  "\n\n[Output truncated. Narrow it with `sheet`, `range`, `max_rows`, or `pages`.]";

const readOfficeFileSchema = z.object({
  path: z
    .string()
    .describe(
      "File to read: attachments:<name> or a path relative to the app root.",
    ),
  sheet: z
    .string()
    .optional()
    .describe("Spreadsheets only: read just this sheet (by name)."),
  range: z
    .string()
    .optional()
    .describe('Spreadsheets only: cell range such as "A1:F50".'),
  max_rows: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .describe("Spreadsheets only: max rows per sheet (default 200)."),
  pages: z
    .string()
    .optional()
    .describe('PDFs only: page range such as "1-3" (default: all).'),
});

type ReadArgs = z.infer<typeof readOfficeFileSchema>;

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------

function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRange(range: string): {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
} {
  const m = /^\s*([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?\s*$/.exec(range);
  if (!m) {
    throw new DyadError(
      `Invalid range "${range}". Use a form like A1:F50.`,
      DyadErrorKind.Validation,
    );
  }
  const c1 = colToNum(m[1]);
  const r1 = parseInt(m[2], 10);
  const c2 = m[3] ? colToNum(m[3]) : c1;
  const r2 = m[4] ? parseInt(m[4], 10) : r1;
  return {
    r1: Math.min(r1, r2),
    r2: Math.max(r1, r2),
    c1: Math.min(c1, c2),
    c2: Math.max(c1, c2),
  };
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const f = (o.formula ?? o.sharedFormula ?? "") as string;
      const result = cellText((o.result ?? null) as ExcelJS.CellValue);
      return result ? `=${f} → ${result}` : `=${f}`;
    }
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text: string }>)
        .map((t) => t.text)
        .join("");
    }
    if ("hyperlink" in o) return String(o.text ?? o.hyperlink);
    if ("error" in o) return String(o.error);
    return JSON.stringify(o);
  }
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
}

async function readSpreadsheet(file: string, args: ReadArgs): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const maxRows = args.max_rows ?? 200;
  const sheets = args.sheet
    ? wb.worksheets.filter((w) => w.name === args.sheet)
    : wb.worksheets;
  if (sheets.length === 0) {
    throw new DyadError(
      `Sheet not found: ${args.sheet}. Sheets in this file: ${wb.worksheets.map((w) => w.name).join(", ")}`,
      DyadErrorKind.NotFound,
    );
  }
  const limits = args.range ? parseRange(args.range) : null;
  const out: string[] = [];
  out.push(
    `Workbook sheets: ${wb.worksheets.map((w) => `${w.name} (${w.rowCount} rows × ${w.columnCount} cols)`).join("; ")}`,
  );
  for (const ws of sheets) {
    const r1 = limits?.r1 ?? 1;
    const r2 = Math.min(limits?.r2 ?? ws.rowCount, ws.rowCount);
    const c1 = limits?.c1 ?? 1;
    const c2 = limits?.c2 ?? Math.max(ws.columnCount, 1);
    out.push(`\n## Sheet "${ws.name}"`);
    const header = ["row"];
    for (let c = c1; c <= c2; c++) header.push(numToCol(c));
    out.push(header.join("\t"));
    let shown = 0;
    let lastRow = r1 - 1;
    for (let r = r1; r <= r2; r++) {
      if (shown >= maxRows) break;
      const row = ws.getRow(r);
      const cells: string[] = [String(r)];
      let any = false;
      for (let c = c1; c <= c2; c++) {
        const t = cellText(row.getCell(c).value);
        if (t) any = true;
        cells.push(t);
      }
      lastRow = r;
      if (!any) continue;
      out.push(cells.join("\t"));
      shown++;
    }
    if (lastRow < r2) {
      out.push(
        `[Stopped at row ${lastRow} of ${r2}. Use range or max_rows to read more.]`,
      );
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Word / PowerPoint / PDF
// ---------------------------------------------------------------------------

async function readDocx(file: string): Promise<string> {
  try {
    // convertToMarkdown exists at runtime but is missing from the typings.
    const toMarkdown = (
      mammoth as unknown as {
        convertToMarkdown: (input: {
          path: string;
        }) => Promise<{ value: string }>;
      }
    ).convertToMarkdown;
    const result = await toMarkdown({ path: file });
    if (result.value.trim()) return result.value;
  } catch {
    // fall through to raw text
  }
  const raw = await mammoth.extractRawText({ path: file });
  return raw.value;
}

async function readPptx(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fsp.readFile(file));
  const slideNames = Object.keys(zip.files)
    .map((n) => ({ n, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => !!x.m)
    .sort((a, b) => parseInt(a.m[1], 10) - parseInt(b.m[1], 10));
  const paragraphs = (xml: string): string[] =>
    [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
      .map((p) =>
        [...p[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
          .map((t) => decodeXmlEntities(t[1]))
          .join(""),
      )
      .filter((s) => s.trim());
  const out: string[] = [];
  for (const { n, m } of slideNames) {
    const num = m[1];
    out.push(`\n## Slide ${num}`);
    out.push(...paragraphs(await zip.files[n].async("string")));
    const notes = zip.files[`ppt/notesSlides/notesSlide${num}.xml`];
    if (notes) {
      const noteText = paragraphs(await notes.async("string")).join("\n");
      if (noteText.trim()) out.push(`\n[Speaker notes]\n${noteText}`);
    }
  }
  return out.join("\n");
}

function parsePageRange(pages: string | undefined, total: number): number[] {
  if (!pages) return Array.from({ length: total }, (_, i) => i + 1);
  const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(pages);
  if (!m) {
    throw new DyadError(
      `Invalid pages "${pages}". Use a form like 1-3.`,
      DyadErrorKind.Validation,
    );
  }
  const a = Math.max(1, parseInt(m[1], 10));
  const b = Math.min(total, m[2] ? parseInt(m[2], 10) : a);
  const list: number[] = [];
  for (let p = a; p <= b; p++) list.push(p);
  return list;
}

async function readPdf(file: string, pages?: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await fsp.readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  const pageTexts = text as unknown as string[];
  const wanted = parsePageRange(pages, pageTexts.length);
  const out = [`PDF with ${pageTexts.length} page(s).`];
  for (const p of wanted) {
    out.push(`\n## Page ${p}\n${pageTexts[p - 1] ?? ""}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const LEGACY_TARGET: Record<string, string> = {
  ".xls": "xlsx",
  ".ods": "xlsx",
  ".doc": "docx",
  ".odt": "docx",
  ".rtf": "docx",
  ".ppt": "pptx",
  ".odp": "pptx",
};

async function readByExtension(
  file: string,
  ext: string,
  args: ReadArgs,
): Promise<string> {
  switch (ext) {
    case ".xlsx":
    case ".xlsm":
      return readSpreadsheet(file, args);
    case ".docx":
      return readDocx(file);
    case ".pptx":
      return readPptx(file);
    case ".pdf":
      return readPdf(file, args.pages);
    default:
      throw new DyadError(
        `Unsupported file type "${ext}". Supported: .xlsx .xlsm .docx .pptx .pdf plus legacy .xls .doc .ppt .ods .odt .odp .rtf (via LibreOffice).`,
        DyadErrorKind.Validation,
      );
  }
}

export const readOfficeFileTool: ToolDefinition<ReadArgs> = {
  name: "read_office_file",
  description: `Read the contents of an office document directly: Excel (.xlsx/.xlsm), Word (.docx), PowerPoint (.pptx), PDF, and legacy/OpenDocument formats (.xls .doc .ppt .ods .odt .odp .rtf, converted with LibreOffice).
Use this instead of read_file or sandbox scripts for any of these types — they are zip/binary files that cannot be read as text.
- Spreadsheets: returns every sheet as a tab-separated grid with row numbers and column letters; formulas appear as "=formula → cached result". Use sheet, range and max_rows to narrow large workbooks.
- Word: returns the text as Markdown (headings, lists, tables).
- PowerPoint: returns each slide's text plus speaker notes.
- PDF: returns text per page; use pages like "1-3".
Accepts attachments:<name> paths and app-relative paths.`,
  inputSchema: readOfficeFileSchema,
  defaultConsent: "always",
  mutationTracking: "none",

  getConsentPreview: (args) => `Read office file ${args.path}`,

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    return `<dyad-read path="${escapeXmlAttr(args.path)}"></dyad-read>`;
  },

  execute: async (args: ReadArgs, ctx: AgentContext) => {
    const file = await resolveInputFile(ctx, args.path);
    const ext = extOf(args.path.startsWith("attachments:") ? file : args.path);
    let text: string;
    const legacyTarget = LEGACY_TARGET[ext];
    if (legacyTarget) {
      const converted = await convertWithLibreOffice({
        inputFile: file,
        targetFormat: legacyTarget,
      });
      try {
        text = await readByExtension(
          converted.outputFile,
          `.${legacyTarget}`,
          args,
        );
      } finally {
        await converted.cleanup();
      }
    } else {
      text = await readByExtension(file, ext, args);
    }
    if (text.length > OUTPUT_LIMIT_CHARS) {
      return text.slice(0, OUTPUT_LIMIT_CHARS) + TRUNCATION_NOTICE;
    }
    return text;
  },
};
