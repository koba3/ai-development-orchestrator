const RICH_TEXT_LIMIT = 1900;

export function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  if (value.length === 0) {
    return [];
  }
  const chunks: Array<{ type: "text"; text: { content: string } }> = [];
  for (let index = 0; index < value.length; index += RICH_TEXT_LIMIT) {
    chunks.push({
      type: "text",
      text: { content: value.slice(index, index + RICH_TEXT_LIMIT) },
    });
  }
  return chunks;
}
