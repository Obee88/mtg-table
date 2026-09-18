import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';

const USER_AGENT = 'mtg-table/0.1 (https://mtg.codes.hr)';
const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

export interface BulkInfo {
  /** Scryfall's `updated_at` for the file; used to skip unchanged data. */
  updatedAt: string;
  downloadUri: string;
  compressedSize: number;
}

/** Where card data comes from. Tests substitute a fake. */
export interface CardSource {
  bulkInfo(): Promise<BulkInfo>;
  cards(downloadUri: string): AsyncIterable<unknown>;
}

const bulkListSchema = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      updated_at: z.string(),
      jsonl_download_uri: z.string().optional(),
      compressed_size: z.number().optional(),
    }),
  ),
});

export const scryfallSource: CardSource = {
  async bulkInfo() {
    const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
    if (!res.ok) throw new Error(`Scryfall bulk-data listing failed: ${res.status}`);
    const list = bulkListSchema.parse(await res.json());
    const entry = list.data.find((b) => b.type === 'default_cards');
    if (!entry?.jsonl_download_uri) throw new Error('Scryfall listing has no default_cards JSONL file');
    return { updatedAt: entry.updated_at, downloadUri: entry.jsonl_download_uri, compressedSize: entry.compressed_size ?? 0 };
  },

  // Gzipped JSONL, one card per line: streams with constant memory.
  async *cards(downloadUri) {
    const res = await fetch(downloadUri, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`Scryfall bulk download failed: ${res.status}`);
    let stream: NodeJS.ReadableStream = Readable.fromWeb(res.body as WebReadableStream);
    const alreadyDecoded = res.headers.get('content-encoding')?.includes('gzip');
    if (downloadUri.endsWith('.gz') && !alreadyDecoded) stream = stream.pipe(createGunzip());
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      yield JSON.parse(trimmed) as unknown;
    }
  },
};
