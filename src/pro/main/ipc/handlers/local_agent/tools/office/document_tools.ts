import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  PageBreak,
  LevelFormat,
} from "docx";
import PptxGenJS from "pptxgenjs";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "../types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  convertWithLibreOffice,
  resolveInputFile,
  writeOutputFile,
} from "./office_utils";

// ---------------------------------------------------------------------------
// write_document — new .docx
// ---------------------------------------------------------------------------

const block = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z.number().int().min(1).max(4).optional(),
    text: z.string(),
  }),
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string()) }),
  z.object({ type: z.literal("numbered"), items: z.array(z.string()) }),
  z.object({
    type: z.literal("table"),
    header: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())),
  }),
  z.object({ type: z.literal("page_break") }),
]);

const writeDocumentSchema = z.object({
  path: z
    .string()
    .describe("Output path relative to the app root, ending in .docx"),
  title: z.string().optional().describe("Optional title shown at the top."),
  blocks: z
    .array(block)
    .describe(
      "Document content in order. Inline **bold** and *italic* are supported in text.",
    ),
  description: z.string().optional(),
});

function runs(text: string, base: { bold?: boolean; size?: number } = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return new TextRun({ ...base, text: part.slice(2, -2), bold: true });
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return new TextRun({ ...base, text: part.slice(1, -1), italics: true });
    }
    return new TextRun({ ...base, text: part });
  });
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

export const writeDocumentTool: ToolDefinition<
  z.infer<typeof writeDocumentSchema>
> = {
  name: "write_document",
  description:
    "Create a new Word document (.docx) from structured blocks: headings, paragraphs, bullet lists, numbered lists, tables and page breaks. Overwrites an existing file at that path.",
  inputSchema: writeDocumentSchema,
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",

  getConsentPreview: (args) => `Create document ${args.path}`,

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    return `<dyad-write path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "Create document")}"></dyad-write>`;
  },

  execute: async (args, ctx: AgentContext) => {
    if (!/\.docx$/i.test(args.path)) {
      throw new DyadError("Path must end in .docx", DyadErrorKind.Validation);
    }
    const children: Array<Paragraph | Table> = [];
    let listInstance = 0;
    if (args.title) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: args.title })],
        }),
      );
    }
    for (const b of args.blocks) {
      switch (b.type) {
        case "heading":
          children.push(
            new Paragraph({
              heading: HEADINGS[(b.level ?? 1) - 1],
              children: runs(b.text),
            }),
          );
          break;
        case "paragraph":
          children.push(
            new Paragraph({ spacing: { after: 120 }, children: runs(b.text) }),
          );
          break;
        case "bullets":
          for (const item of b.items) {
            children.push(
              new Paragraph({ bullet: { level: 0 }, children: runs(item) }),
            );
          }
          break;
        case "numbered": {
          listInstance++;
          for (const item of b.items) {
            children.push(
              new Paragraph({
                numbering: {
                  reference: "numbered-list",
                  level: 0,
                  instance: listInstance,
                },
                children: runs(item),
              }),
            );
          }
          break;
        }
        case "table": {
          const makeRow = (cells: string[], bold: boolean) =>
            new TableRow({
              tableHeader: bold,
              children: cells.map(
                (c) =>
                  new TableCell({
                    children: [new Paragraph({ children: runs(c, { bold }) })],
                  }),
              ),
            });
          const rows = [
            ...(b.header ? [makeRow(b.header, true)] : []),
            ...b.rows.map((r) => makeRow(r, false)),
          ];
          if (rows.length > 0) {
            children.push(
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows,
              }),
              new Paragraph({ children: [] }),
            );
          }
          break;
        }
        case "page_break":
          children.push(new Paragraph({ children: [new PageBreak()] }));
          break;
      }
    }
    const doc = new Document({
      creator: "Crackerbox",
      numbering: {
        config: [
          {
            reference: "numbered-list",
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: "start",
              },
            ],
          },
        ],
      },
      sections: [{ children }],
    });
    const buffer = await Packer.toBuffer(doc);
    const written = await writeOutputFile(ctx, args.path, buffer);
    return `Successfully wrote ${written}`;
  },
};

// ---------------------------------------------------------------------------
// write_presentation — new .pptx
// ---------------------------------------------------------------------------

const writePresentationSchema = z.object({
  path: z
    .string()
    .describe("Output path relative to the app root, ending in .pptx"),
  slides: z
    .array(
      z.object({
        title: z.string(),
        bullets: z.array(z.string()).optional(),
        text: z
          .string()
          .optional()
          .describe("Plain paragraph under the title."),
        table: z
          .object({
            header: z.array(z.string()).optional(),
            rows: z.array(z.array(z.string())),
          })
          .optional(),
        notes: z.string().optional().describe("Speaker notes."),
      }),
    )
    .min(1),
  description: z.string().optional(),
});

export const writePresentationTool: ToolDefinition<
  z.infer<typeof writePresentationSchema>
> = {
  name: "write_presentation",
  description:
    "Create a new PowerPoint deck (.pptx) from slides, each with a title and optional bullets, paragraph, table and speaker notes. Overwrites an existing file at that path.",
  inputSchema: writePresentationSchema,
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",

  getConsentPreview: (args) => `Create presentation ${args.path}`,

  buildXml: (args, _isComplete) => {
    if (!args.path) return undefined;
    return `<dyad-write path="${escapeXmlAttr(args.path)}" description="${escapeXmlAttr(args.description ?? "Create presentation")}"></dyad-write>`;
  },

  execute: async (args, ctx: AgentContext) => {
    if (!/\.pptx$/i.test(args.path)) {
      throw new DyadError("Path must end in .pptx", DyadErrorKind.Validation);
    }
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Crackerbox";
    for (const s of args.slides) {
      const slide = pptx.addSlide();
      slide.addText(s.title, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.8,
        fontSize: 28,
        bold: true,
      });
      let y = 1.3;
      if (s.text) {
        slide.addText(s.text, {
          x: 0.5,
          y,
          w: 9,
          h: 1,
          fontSize: 18,
          valign: "top",
        });
        y += 1.1;
      }
      if (s.bullets?.length) {
        slide.addText(
          s.bullets.map((t) => ({ text: t, options: { bullet: true } })),
          { x: 0.5, y, w: 9, h: 5.2 - y, fontSize: 18, valign: "top" },
        );
      }
      if (s.table) {
        const rows = [
          ...(s.table.header
            ? [
                s.table.header.map((t) => ({
                  text: t,
                  options: { bold: true },
                })),
              ]
            : []),
          ...s.table.rows.map((r) => r.map((t) => ({ text: t }))),
        ];
        slide.addTable(rows, {
          x: 0.5,
          y: s.bullets?.length ? y + 1.5 : y,
          w: 9,
          fontSize: 14,
          border: { type: "solid", pt: 0.5, color: "999999" },
        });
      }
      if (s.notes) slide.addNotes(s.notes);
    }
    const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    const written = await writeOutputFile(ctx, args.path, out);
    return `Successfully wrote ${written} (${args.slides.length} slide(s))`;
  },
};

// ---------------------------------------------------------------------------
// convert_office_file — LibreOffice format conversion
// ---------------------------------------------------------------------------

const convertSchema = z.object({
  path: z.string().describe("Source file: attachments:<name> or app-relative."),
  to: z
    .enum([
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "odt",
      "ods",
      "odp",
      "csv",
      "txt",
      "html",
    ])
    .describe("Target format."),
  output_path: z
    .string()
    .describe("Where to save the converted file (app-relative)."),
});

export const convertOfficeFileTool: ToolDefinition<
  z.infer<typeof convertSchema>
> = {
  name: "convert_office_file",
  description:
    "Convert between office formats with LibreOffice (for example .docx → .pdf, .xls → .xlsx, .xlsx → .csv, .doc → .docx). Needs LibreOffice installed on this computer.",
  inputSchema: convertSchema,
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",

  getConsentPreview: (args) => `Convert ${args.path} to ${args.to}`,

  buildXml: (args, _isComplete) => {
    if (!args.output_path) return undefined;
    return `<dyad-write path="${escapeXmlAttr(args.output_path)}" description="Convert to ${escapeXmlAttr(args.to ?? "")}"></dyad-write>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const source = await resolveInputFile(ctx, args.path);
    const converted = await convertWithLibreOffice({
      inputFile: source,
      targetFormat: args.to,
    });
    try {
      const data = await fsp.readFile(converted.outputFile);
      const written = await writeOutputFile(ctx, args.output_path, data);
      return `Successfully converted ${path.basename(args.path)} to ${args.to}; saved to ${written}`;
    } finally {
      await converted.cleanup();
    }
  },
};
