import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { desEcbDecrypt, desEcbEncryptBlock } from '../../lib/jiosaavn/des.js';

const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
const hexOf = (b) => Buffer.from(b).toString('hex');

describe('DES', () => {
  it('matches the FIPS 46 reference vector', () => {
    assert.equal(
      hexOf(desEcbEncryptBlock(hex('0123456789ABCDEF'), hex('133457799BBCDFF1'))),
      '85e813540f0ab405',
    );
  });

  it('round-trips a block', () => {
    const key = hex('0E329232EA6D0D73');
    const cipher = desEcbEncryptBlock(hex('8787878787878787'), key);
    assert.equal(hexOf(cipher), '0000000000000000');
    assert.equal(hexOf(desEcbDecrypt(cipher, key)), '8787878787878787');
  });
});
