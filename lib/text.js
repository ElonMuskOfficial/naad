/**
 * Text helpers: cleaning JioSaavn's display text and ranking search results.
 */

const NAMED_ENTITIES = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

export function decodeEntities(input) {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Clean display text from JioSaavn (HTML entities, stray whitespace). */
export function cleanText(input) {
  if (!input) return '';
  return decodeEntities(input).replace(/\s+/g, ' ').trim();
}

/** Aggressive fold for comparison: lowercase, strip diacritics/punctuation, keep letters+digits of any script. */
export function fold(input) {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(input) {
  const f = fold(input);
  return f ? f.split(' ') : [];
}
