/** Minimal class with an attributed field, plus a method; no reliance on class-name heuristics. */
export function nativeFixture(native = true): Buffer {
  const utf = (s: string) => { const b = Buffer.from(s); const h = Buffer.alloc(3); h[0] = 1; h.writeUInt16BE(b.length, 1); return Buffer.concat([h, b]); };
  const head = Buffer.from('cafebabe000000340009', 'hex');
  const cp = Buffer.concat([utf('fixture/Probe'), Buffer.from('070001', 'hex'), utf('java/lang/Object'),
    Buffer.from('070003', 'hex'), utf('field'), utf('I'), utf('method'), utf('()V')]);
  const tail = Buffer.from('00210002000400000001000100050006000100050000000200000001', 'hex');
  const method = Buffer.alloc(8); method.writeUInt16BE(native ? 0x0109 : 0x0009); method.writeUInt16BE(7, 2); method.writeUInt16BE(8, 4);
  return Buffer.concat([head, cp, tail, method, Buffer.alloc(2)]);
}
