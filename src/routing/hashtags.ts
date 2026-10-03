const HASHTAG_PATTERN = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g;

export function normalizeHashtag(value: string): string {
  return value.trim().toLowerCase();
}

export function extractHashtags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1] ? normalizeHashtag(match[1]) : "";
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}
