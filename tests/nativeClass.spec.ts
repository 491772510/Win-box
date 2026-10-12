import { describe, expect, it } from 'vitest';
import { hasNativeMethods } from '../src/engine/spider/nativeClass';
import { nativeFixture } from './fixtures/nativeClass';

describe('native declarations (dynamic library bridge)', () => {
  it('detects native methods even without an embedded .so', () => expect(hasNativeMethods(nativeFixture())).toBe(true));
  it('ordinary methods do not enable ARM emulation', () => expect(hasNativeMethods(nativeFixture(false))).toBe(false));
  it('rejects truncated and non-class data without throwing', () => {
    const fixture = nativeFixture();
    for (let i = 0; i < fixture.length - 2; i++) expect(hasNativeMethods(fixture.subarray(0, i))).toBe(false);
    expect(hasNativeMethods(Buffer.from('native System.load DexNative'))).toBe(false);
  });
});
