import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_search");

const webSearchSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

const DESCRIPTION = `
Use this tool to access real-time information beyond your training data cutoff.

When to Search:
- Current API documentation, library versions, or breaking changes
- Latest best practices, security advisories, or bug fixes
- Specific error messages or troubleshooting solutions
- Recent framework updates or deprecation notices

Query Tips:
- Be specific: Include version numbers, exact error messages, or technical terms
- Add context: "React 19 useEffect cleanup" not just "React hooks"

Examples:

<example>
OpenAI GPT-5 API model names
</example>

<example>
NextJS 14 app router middleware auth
</example>
`;

/**
 * Parse SSE events from a buffer and extract content deltas.
 * Returns the remaining unparsed buffer.
 * Throws an error if an SSE error event is received.
 */
function parseSSEEvents(
  buffer: string,
  onContent: (content: string) => void,
): string {
  const lines = buffer.split("\n");
  // Keep the last potentially incomplete line
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) {
      continue;
    }

    const data = trimmed.slice(6); // Remove "data: " prefix

    // Check for stream end marker
    if (data === "[DONE]") {
      continue;
    }

    try {
      const json = JSON.parse(data);

      // Check for OpenAI-style SSE error: { error: { message: "...", type: "...", code: "..." } }
      if (json.error) {
        const errorMessage =
          json.error.message || json.error.type || "Unknown SSE error";
        throw new DyadError(
          `Web search SSE error: ${errorMessage}`,
          DyadErrorKind.External,
        );
      }

      // OpenAI-style SSE format: { choices: [{ delta: { content: "..." } }] }
      const content = json.choices?.[0]?.delta?.content;
      if (content) {
        onContent(content);
      }
    } catch (e) {
      // Re-throw SSE errors
      if (e instanceof Error && e.message.startsWith("Web search SSE error:")) {
        throw e;
      }
      // Skip malformed JSON lines
      logger.warn("Failed to parse SSE JSON:", data);
    }
  }

  return remaining;
}

const WEB_SEARCH_TIMEOUT_MS = 90_000;

/**
 * Call OpenRouter's chat completions endpoint with the "web" search
 * plugin enabled (Parallel engine, turbo mode) and stream results.
 * Crackerbox doesn't use Dyad's Pro engine -- this runs on Tim's own
 * OpenRouter key instead, same key he already uses for chat.
 */
async function callWebSearchSSE(
  query: string,
  ctx: AgentContext,
): Promise<string> {
  ctx.onXmlStream(`<dyad-web-search query="${escapeXmlAttr(query)}">`);

  const settings = readSettings();
  const apiKey = settings.providerSettings?.openrouter?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError(
      "An OpenRouter API key is required for web search. Add one in Settings.",
      DyadErrorKind.Auth,
    );
  }

  const model = settings.selectedModel?.name || "openai/gpt-4o-mini";

  const controller = new AbortController();
  const onAbort = () => controller.abort(ctx.abortSignal?.reason);
  if (ctx.abortSignal) {
    if (ctx.abortSignal.aborted) {
      controller.abort(ctx.abortSignal.reason);
    } else {
      ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: "user",
            content: `Search the web and answer concisely, citing sources: ${query}`,
          },
        ],
        plugins: [
          {
            id: "web",
            engine: "parallel",
            mode: "turbo",
            max_results: 5,
          },
        ],
      }),
    });
  } finally {
    clearTimeout(timeout);
    if (ctx.abortSignal) {
      ctx.abortSignal.removeEventListener("abort", onAbort);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Web search failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  if (!response.body) {
    throw new DyadError(
      "Web search response has no body",
      DyadErrorKind.External,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  let streamCompleted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamCompleted = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events and accumulate content
      buffer = parseSSEEvents(buffer, (content) => {
        accumulated += content;
        // Stream intermediate results to UI with dyad-web-search prefix
        ctx.onXmlStream(
          `<dyad-web-search query="${escapeXmlAttr(query)}">${escapeXmlContent(accumulated)}`,
        );
      });
    }

    // Handle any remaining buffer content
    if (buffer.trim()) {
      parseSSEEvents(buffer + "\n", (content) => {
        accumulated += content;
      });
    }
  } finally {
    if (!streamCompleted) {
      await reader.cancel().catch((error) => {
        logger.warn("Failed to cancel abandoned web search response:", error);
      });
    }
    reader.releaseLock();
  }

  return accumulated;
}

export const webSearchTool: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description: DESCRIPTION,
  inputSchema: webSearchSchema,
  defaultConsent: "ask",

  // Uses Tim's own OpenRouter key -- no Dyad Pro engine required.
  isEnabled: () => true,

  getConsentPreview: (args) => `Search the web: "${args.query}"`,

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing web search: ${args.query}`);

    const result = await callWebSearchSSE(args.query, ctx);

    if (!result) {
      throw new DyadError(
        "Web search returned no results",
        DyadErrorKind.External,
      );
    }

    // Write final result to UI and DB with dyad-web-search wrapper
    ctx.onXmlComplete(
      `<dyad-web-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(result)}</dyad-web-search>`,
    );

    logger.log(`Web search completed for query: ${args.query}`);
    return result;
  },
};
