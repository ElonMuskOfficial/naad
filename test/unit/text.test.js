import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanText, decodeEntities, fold, tokens } from '../../lib/text.js';

describe('text helpers', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    assert.equal(decodeEntities('Tom &amp; Jerry &#39;s &#x41; &bogus;'), "Tom & Jerry 's A &bogus;");
  });

  it('cleans whitespace and null-ish input', () => {
    assert.equal(cleanText('  a &quot;b&quot;\n c '), 'a "b" c');
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(undefined), '');
  });

  it('folds case, diacritics and punctuation', () => {
    assert.equal(fold('Beyoncé & Jay-Z!'), 'beyonce and jay z');
    assert.deepEqual(tokens('  '), []);
  });

  it('keeps Devanagari searchable instead of folding it away', () => {
    assert.notEqual(fold('तेरी मिट्टी'), '');
    assert.notEqual(fold('तेरी मिट्टी'), fold('अरिजीत'));
    assert.equal(tokens('तेरी मिट्टी').length, 2);
  });
});
