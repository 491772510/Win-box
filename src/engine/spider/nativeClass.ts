/** Inspect method access flags, not strings/class names: dynamic ARM loaders can have no .so in the outer JAR. */
export function hasNativeMethods(bytes: Buffer): boolean {
  try {
    if (bytes.readUInt32BE(0) !== 0xcafebabe) return false;
    let p = 10;
    const count = bytes.readUInt16BE(8);
    for (let i = 1; i < count; i++) {
      const tag = bytes[p++];
      if (tag === 1) { const size = bytes.readUInt16BE(p); p += 2 + size; }
      else if (tag === 5 || tag === 6) { p += 8; i++; }
      else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) p += 4;
      else if ([7, 8, 16, 19, 20].includes(tag)) p += 2;
      else if (tag === 15) p += 3;
      else return false;
    }
    p += 6;
    const interfaces = bytes.readUInt16BE(p);
    p += 2 + interfaces * 2;
    const skipMember = (): number => {
      const access = bytes.readUInt16BE(p);
      const attributes = bytes.readUInt16BE(p + 6);
      p += 8;
      for (let a = 0; a < attributes; a++) {
        const size = bytes.readUInt32BE(p + 2);
        p += 6 + size;
      }
      if (p > bytes.length) throw new Error('Truncated class');
      return access;
    };
    const fields = bytes.readUInt16BE(p); p += 2;
    for (let i = 0; i < fields; i++) skipMember();
    const methods = bytes.readUInt16BE(p); p += 2;
    for (let i = 0; i < methods; i++) if ((skipMember() & 0x0100) !== 0) return true;
  } catch { /* malformed class: do not opt in */ }
  return false;
}
