import { crc32 } from 'node:zlib';

/**
 * Streaming ZIP writer (stored, no compression: slides are already compressed). Entries are written
 * as they arrive with data descriptors, so a large class is never held in memory, and ZIP64 records
 * are always used so archives over 4 GB stay valid.
 */
export interface ZipEntry {
  /** Path inside the archive, "/"-separated. */
  name: string;
  /** Opens the data only when the entry's turn comes; null skips the entry. */
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

const crc = crc32 as unknown as (data: Uint8Array, value?: number) => number;

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export function zipStream(entries: ZipEntry[], now = new Date()): ReadableStream<Uint8Array> {
  const { time, day } = dosTime(now);
  const central: Buffer[] = [];
  let offset = 0n;
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let current: { name: Buffer; start: bigint; crc: number; size: bigint } | null = null;
  let finished = false;

  const push = (controller: ReadableStreamDefaultController<Uint8Array>, ...parts: Buffer[]) => {
    const chunk = Buffer.concat(parts);
    offset += BigInt(chunk.length);
    controller.enqueue(chunk);
  };

  function endEntry(controller: ReadableStreamDefaultController<Uint8Array>) {
    const e = current!;
    current = null;
    reader = null;
    push(controller, u32(0x08074b50), u32(e.crc), u64(e.size), u64(e.size));
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(45),
        u16(45),
        u16(0x0808),
        u16(0),
        u16(time),
        u16(day),
        u32(e.crc),
        u32(0xffffffff),
        u32(0xffffffff),
        u16(e.name.length),
        u16(28),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(0xffffffff),
        e.name,
        u16(1),
        u16(24),
        u64(e.size),
        u64(e.size),
        u64(e.start),
      ]),
    );
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (reader && current) {
          const { done, value } = await reader.read();
          if (done) return endEntry(controller);
          current.crc = crc(value, current.crc);
          current.size += BigInt(value.length);
          return push(controller, Buffer.from(value.buffer, value.byteOffset, value.length));
        }
        while (index < entries.length) {
          const entry = entries[index++];
          const body = await entry.open();
          if (!body) continue; // skipped
          const name = Buffer.from(entry.name, 'utf8');
          current = { name, start: offset, crc: 0, size: 0n };
          reader = body.getReader();
          return push(
            controller,
            u32(0x04034b50),
            u16(45),
            u16(0x0808),
            u16(0),
            u16(time),
            u16(day),
            u32(0),
            u32(0xffffffff),
            u32(0xffffffff),
            u16(name.length),
            u16(20),
            name,
            u16(1),
            u16(16),
            u64(0n),
            u64(0n),
          );
        }
        if (finished) return controller.close();
        finished = true;
        const cdStart = offset;
        const cd = Buffer.concat(central);
        push(controller, cd);
        const zip64At = offset;
        push(
          controller,
          u32(0x06064b50),
          u64(44n),
          u16(45),
          u16(45),
          u32(0),
          u32(0),
          u64(BigInt(central.length)),
          u64(BigInt(central.length)),
          u64(BigInt(cd.length)),
          u64(cdStart),
          u32(0x07064b50),
          u32(0),
          u64(zip64At),
          u32(1),
          u32(0x06054b50),
          u16(0),
          u16(0),
          u16(0xffff),
          u16(0xffff),
          u32(0xffffffff),
          u32(0xffffffff),
          u16(0),
        );
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => undefined);
    },
  });
}
