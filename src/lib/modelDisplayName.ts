// OpenRouter writes every model name as "Maker: Model name", for example
// "ByteDance Seed: Seedream 5.0 Flash". Each row already shows the maker's icon,
// and that long shared prefix is what pushed the part that tells models apart
// off the end of the row. Rows show only the model part; the full name stays in
// the aria-label, the search text and the hover title.
export function stripMakerPrefix(displayName: string): string {
  const match = displayName.match(/^[^:]{1,40}:\s+(\S.*)$/);
  return match ? match[1].trim() : displayName;
}
