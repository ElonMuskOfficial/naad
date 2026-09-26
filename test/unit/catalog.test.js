import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relevance } from '../../lib/jiosaavn/catalog.js';

describe('search relevance', () => {
  it('ranks the plain song above remixes and namesake artists', () => {
    const q = 'kesariya arijit';
    const song = relevance(q, 'Kesariya', 'Pritam Arijit Singh');
    const remix = relevance(q, 'Kesariya - Lost Frequencies Remix', 'Pritam Arijit Singh Lost Frequencies');
    assert.ok(song > remix);
    assert.ok(song > relevance(q, 'Arijit'));
  });

  it('gives exact names full marks and supports prefix typing', () => {
    assert.equal(relevance('arijit singh', 'Arijit Singh'), 1);
    assert.ok(relevance('blinding lig', 'Blinding Lights') > 0.8);
  });

  it('scores an empty query as no match', () => {
    assert.equal(relevance('', 'Anything'), 0);
  });

  it('ranks a Devanagari title match above an unrelated one', () => {
    assert.ok(relevance('तेरी मिट्टी', 'तेरी मिट्टी') > relevance('तेरी मिट्टी', 'Unrelated Song'));
  });
});
