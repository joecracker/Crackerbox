import { z } from "zod";
import log from "electron-log";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { ToolDefinition, escapeXmlContent, AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_fetch");

function validateHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
    );
  }
}

const MAX_CONTENT_LENGTH = 80_000;

function truncateContent(value: string): string {
  if (value.length <= MAX_CONTENT_LENGTH) return value;
  return `${value.slice(0, MAX_CONTENT_LENGTH)}\n\n<!-- truncated -->`;
}

const webFetchSchema = z.object({
  url: z.string().describe("URL to fetch content from"),
});

const DESCRIPTION = `Fetch and read the content of a web page as markdown given its URL.

### When to Use This Tool
Use this tool when the user's message contains a URL (or domain name) and they want to:
- **Read** the page's content (e.g. documentation, blog post, article)
- **Reference** information from the page (e.g. API docs, tutorials, guides)
- **Extract** data or context from a live web page to inform their code
- **Follow a link** someone shared to understand its contents

Examples:
- "Use the docs at docs.example.com/api to set up the client"
- "What does this page say? https://example.com/blog/post"
- "Follow the guide at example.com/tutorial"

### When NOT to Use This Tool
- The user wants to **visually clone or replicate** a whole website → this isn't the right tool for that
- The user needs to **search the web** for information without a specific URL → use \`web_search\` instead
`;

const WEB_FETCH_TIMEOUT_MS = 30_000;
const WEB_FETCH_USER_AGENT =
  "Mozilla/5.0 (compatible; CrackerboxBot/1.0; +https://crackerbox.app)";

/**
 * Fetch a URL directly and convert HTML to markdown locally.
 * Crackerbox doesn't use Dyad's Pro crawl engine for this -- a single
 * known URL doesn't need a hosted crawler, just a plain fetch.
 */
async function callWebFetch(
  url: string,
  ctx: Pick<AgentContext, "dyadRequestId" | "abortSignal">,
): Promise<string> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(ctx.abortSignal?.reason);
  if (ctx.abortSignal) {
    if (ctx.abortSignal.aborted) {
      controller.abort(ctx.abortSignal.reason);
    } else {
      ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": WEB_FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
    if (ctx.abortSignal) {
      ctx.abortSignal.removeEventListener("abort", onAbort);
    }
  }

  if (!response.ok) {
    throw new Error(
      `Web fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (contentType.includes("html")) {
    return NodeHtmlMarkdown.translate(body);
  }

  return body;
}

export const webFetchTool: ToolDefinition<z.infer<typeof webFetchSchema>> = {
  name: "web_fetch",
  description: DESCRIPTION,
  inputSchema: webFetchSchema,
  defaultConsent: "always",

  isEnabled: () => true,

  getConsentPreview: (args) => `Fetch URL: "${args.url}"`,

  buildXml: (args, isComplete) => {
    if (!args.url) return undefined;
    // When complete, return undefined so execute's onXmlComplete provides the final XML
    if (isComplete) return undefined;
    return `<dyad-web-fetch>${escapeXmlContent(args.url)}`;
  },

  execute: async (args, ctx) => {
    logger.log(`Executing web fetch: ${args.url}`);

    validateHttpUrl(args.url);

    ctx.onXmlStream(`<dyad-web-fetch>${escapeXmlContent(args.url)}`);

    try {
      const markdown = await callWebFetch(args.url, ctx);

      if (!markdown || !markdown.trim()) {
        throw new DyadError(
          "No content available from web fetch",
          DyadErrorKind.NotFound,
        );
      }

      logger.log(`Web fetch completed for URL: ${args.url}`);

      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );

      return truncateContent(markdown);
    } catch (error) { 
      ctx.onXmlComplete(
        `<dyad-web-fetch>${escapeXmlContent(args.url)}</dyad-web-fetch>`,
      );
      throw error;
    }
  },
};
