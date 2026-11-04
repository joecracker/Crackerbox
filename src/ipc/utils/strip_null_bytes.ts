// Some model replies can contain a NUL ("null") character. It is saved in the
// chat, and every later request that resends the chat is then refused by the
// provider ("String must not contain null bytes"), which locks the chat up.
// In the JSON request body a NUL is written as the six characters \u0000, so it
// is removed there. A backslash before it (an escaped backslash followed by the
// plain text "u0000") is left alone.
const ESCAPED_NUL = /(?<!\\)((?:\\\\)*)\\u0000/g;

export function stripNullBytesFromJson(body: string): string {
  return body.includes("\\u0000") ? body.replace(ESCAPED_NUL, "$1") : body;
}

export function withoutNullBytes(
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return (async (input: any, init?: any) => {
    if (init && typeof init.body === "string") {
      const cleaned = stripNullBytesFromJson(init.body);
      if (cleaned !== init.body) init = { ...init, body: cleaned };
    }
    return baseFetch(input, init);
  }) as typeof fetch;
}
