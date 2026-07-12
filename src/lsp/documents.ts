import { expect } from "../expect.ts";
import {
  encoded_length,
  type LspRange,
  offsets_from_range,
  type PositionEncoding,
} from "./position.ts";

export type TextDocument = {
  uri: string;
  version: number;
  text: string;
};

export type TextDocumentChange = {
  text: string;
  range?: LspRange;
  rangeLength?: number;
};

type CachedValue = {
  content_hash: string;
  text: string;
  value: unknown;
};

export type DocumentCacheMetrics = {
  content_hash: string;
  computations: number;
  cache_hits: number;
  computed_bytes: number;
  invalidations: number;
};

export class DocumentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentStoreError";
  }
}

export class DocumentStore {
  readonly position_encoding: PositionEncoding;
  #documents = new Map<string, TextDocument>();
  #cache = new Map<string, Map<string, CachedValue>>();
  #compute_counts = new Map<string, Map<string, number>>();
  #cache_hit_counts = new Map<string, Map<string, number>>();
  #computed_bytes = new Map<string, Map<string, number>>();
  #content_hashes = new Map<string, string>();
  #invalidation_counts = new Map<string, number>();

  constructor(position_encoding: PositionEncoding = "utf-16") {
    this.position_encoding = position_encoding;
  }

  open(uri: string, version: number, text: string): void {
    expect_valid_version(version);
    const existing = this.#documents.get(uri);

    if (existing !== undefined) {
      if (version <= existing.version) {
        throw new DocumentStoreError(
          "opened document version must increase",
        );
      }
    }

    this.#documents.set(uri, { uri, version, text });
    this.#content_hashes.set(uri, document_content_hash(text));
    this.invalidate_cache(uri);
  }

  close(uri: string): void {
    this.#documents.delete(uri);
    this.#cache.delete(uri);
    this.#content_hashes.delete(uri);
  }

  get(uri: string): TextDocument | undefined {
    return this.#documents.get(uri);
  }

  open_documents(): TextDocument[] {
    return [...this.#documents.values()].sort((left, right) =>
      left.uri.localeCompare(right.uri)
    );
  }

  apply_changes(
    uri: string,
    version: number,
    changes: readonly TextDocumentChange[],
  ): TextDocument {
    expect_valid_version(version);
    const current = this.#documents.get(uri);

    if (current === undefined) {
      throw new DocumentStoreError(
        "cannot change a document that is not open",
      );
    }

    if (version <= current.version) {
      throw new DocumentStoreError("changed document version must increase");
    }

    if (changes.length === 0) {
      throw new DocumentStoreError("document changes must not be empty");
    }

    let text = current.text;

    for (const change of changes) {
      if (change.range === undefined) {
        if (change.rangeLength !== undefined) {
          throw new DocumentStoreError(
            "full document changes must not specify rangeLength",
          );
        }

        text = change.text;
        continue;
      }

      let offsets: ReturnType<typeof offsets_from_range>;

      try {
        offsets = offsets_from_range(
          text,
          change.range,
          this.position_encoding,
        );
      } catch (error) {
        if (error instanceof Error) {
          throw new DocumentStoreError(error.message);
        }

        throw error;
      }

      if (change.rangeLength !== undefined) {
        const replaced_length = encoded_length(
          text.slice(offsets.start, offsets.end),
          this.position_encoding,
        );

        if (change.rangeLength !== replaced_length) {
          throw new DocumentStoreError(
            "change rangeLength does not match the replaced text",
          );
        }
      }

      text = text.slice(0, offsets.start) + change.text +
        text.slice(offsets.end);
    }

    const document = { uri, version, text };
    this.#documents.set(uri, document);
    this.#content_hashes.set(uri, document_content_hash(text));
    this.invalidate_cache(uri);
    return document;
  }

  compute<T>(uri: string, key: string, analyze: (text: string) => T): T {
    const document = this.#documents.get(uri);
    expect(
      document !== undefined,
      "cannot analyze a document that is not open",
    );
    const content_hash = this.#content_hashes.get(uri);
    expect(content_hash !== undefined, "missing document content hash");
    let entries = this.#cache.get(uri);

    if (entries === undefined) {
      entries = new Map();
      this.#cache.set(uri, entries);
    }

    const cached = entries.get(key);

    if (
      cached !== undefined && cached.content_hash === content_hash &&
      cached.text === document.text
    ) {
      increment_metric(this.#cache_hit_counts, uri, key, 1);
      return cached.value as T;
    }

    const value = analyze(document.text);
    entries.set(key, { content_hash, text: document.text, value });
    increment_metric(this.#compute_counts, uri, key, 1);
    increment_metric(
      this.#computed_bytes,
      uri,
      key,
      new TextEncoder().encode(document.text).length,
    );

    return value;
  }

  compute_count(uri: string, key: string): number {
    return metric_value(this.#compute_counts, uri, key);
  }

  cache_metrics(uri: string, key: string): DocumentCacheMetrics {
    const content_hash = this.#content_hashes.get(uri);
    expect(content_hash !== undefined, "cannot inspect a closed document");
    const invalidations = this.#invalidation_counts.get(uri);
    let invalidation_count = 0;

    if (invalidations !== undefined) {
      invalidation_count = invalidations;
    }

    return {
      content_hash,
      computations: metric_value(this.#compute_counts, uri, key),
      cache_hits: metric_value(this.#cache_hit_counts, uri, key),
      computed_bytes: metric_value(this.#computed_bytes, uri, key),
      invalidations: invalidation_count,
    };
  }

  invalidate_cache(uri: string): void {
    this.#cache.delete(uri);
    const previous = this.#invalidation_counts.get(uri);

    if (previous === undefined) {
      this.#invalidation_counts.set(uri, 1);
    } else {
      this.#invalidation_counts.set(uri, previous + 1);
    }
  }

  will_save(uri: string): void {
    this.invalidate_cache(uri);
  }

  did_save(uri: string): void {
    this.invalidate_cache(uri);
  }

  watched_file_changed(uri: string): void {
    this.invalidate_cache(uri);
  }
}

function increment_metric(
  metrics: Map<string, Map<string, number>>,
  uri: string,
  key: string,
  amount: number,
): void {
  let entries = metrics.get(uri);

  if (entries === undefined) {
    entries = new Map();
    metrics.set(uri, entries);
  }

  const previous = entries.get(key);

  if (previous === undefined) {
    entries.set(key, amount);
  } else {
    entries.set(key, previous + amount);
  }
}

function metric_value(
  metrics: Map<string, Map<string, number>>,
  uri: string,
  key: string,
): number {
  const entries = metrics.get(uri);

  if (entries === undefined) {
    return 0;
  }

  const value = entries.get(key);

  if (value === undefined) {
    return 0;
  }

  return value;
}

export function document_content_hash(text: string): string {
  let first = 2_166_136_261;
  let second = 2_166_136_261 ^ 0x9e3779b9;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619) >>> 0;
    second = Math.imul(second ^ code, 2_246_822_519) >>> 0;
  }

  return text.length.toString(16) + ":" + first.toString(16).padStart(8, "0") +
    second.toString(16).padStart(8, "0");
}

function expect_valid_version(version: number): void {
  if (
    !Number.isInteger(version) || version < -2_147_483_648 ||
    version > 2_147_483_647
  ) {
    throw new DocumentStoreError(
      "document version must be a signed 32-bit integer",
    );
  }
}
