import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySizeTemplate, isAllowedArtHost } from '../../routes/v1/art/index.js';

describe('artwork proxy helpers', () => {
  it('allows only JioSaavn hosts', () => {
    assert.ok(isAllowedArtHost('c.saavncdn.com'));
    assert.ok(isAllowedArtHost('www.jiosaavn.com'));
    for (const h of [
      'i.ytimg.com',
      'localhost',
      '127.0.0.1',
      '169.254.169.254',
      'evil.com',
      'saavncdn.com.evil.com',
    ]) {
      assert.ok(!isAllowedArtHost(h), h);
    }
  });

  it('snaps a requested size to 150x150 or 500x500 — never the blurrier 50x50 tile', () => {
    const url = 'https://c.saavncdn.com/123/Brahmastra-Hindi-2022-500x500.jpg';
    assert.equal(applySizeTemplate(url, 150), 'https://c.saavncdn.com/123/Brahmastra-Hindi-2022-150x150.jpg');
    // A request small enough to have landed on 50x50 gets the next size up instead.
    assert.equal(applySizeTemplate(url, 40), 'https://c.saavncdn.com/123/Brahmastra-Hindi-2022-150x150.jpg');
    assert.equal(applySizeTemplate(url, 1000), url);
  });

  it('leaves the URL alone with no size or no known template', () => {
    const url = 'https://example.com/images/123/origin.jpg';
    assert.equal(applySizeTemplate(url), url);
    assert.equal(applySizeTemplate(url, 0), url);
    assert.equal(applySizeTemplate(url, 300), url);
  });
});
