import { assert_equals } from "../assert.ts";
import { encode_message, MessageDecoder } from "./framing.ts";

export type FixturePosition = {
  line: number;
  character: number;
};

export type FixtureRange = {
  start: FixturePosition;
  end: FixturePosition;
};

export type FixtureExpectation = {
  range: FixtureRange;
  kind: string;
  expected: string;
};

export type LspFixture = {
  source: string;
  spans: Map<string, FixtureRange>;
  expectations: FixtureExpectation[];
};

export type WorkspaceFixture = {
  files: Map<string, LspFixture>;
};

export function parse_fixture(text: string): LspFixture {
  const source_lines: string[] = [];
  const spans = new Map<string, FixtureRange>();
  const expectations: FixtureExpectation[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const marker = parse_marker(line);

    if (marker === undefined) {
      source_lines.push(line);
      continue;
    }

    if (source_lines.length === 0) {
      throw new Error("Fixture marker has no preceding source line");
    }

    const range = {
      start: {
        line: source_lines.length - 1,
        character: marker.character,
      },
      end: {
        line: source_lines.length - 1,
        character: marker.character + marker.length,
      },
    };
    const separator = marker.label.indexOf(":");

    if (separator < 0) {
      if (spans.has(marker.label)) {
        throw new Error("Fixture has duplicate span " + marker.label);
      }

      spans.set(marker.label, range);
      continue;
    }

    const kind = marker.label.slice(0, separator).trim();
    const expected = marker.label.slice(separator + 1).trim();

    if (kind.length === 0 || expected.length === 0) {
      throw new Error("Invalid fixture expectation " + marker.label);
    }

    expectations.push({ range, kind, expected });
  }

  return { source: source_lines.join("\n"), spans, expectations };
}

export function parse_workspace_fixture(text: string): WorkspaceFixture {
  const files = new Map<string, LspFixture>();
  let path: string | undefined;
  let lines: string[] = [];

  const flush = (): void => {
    if (path === undefined) {
      if (lines.some((line) => line.trim().length > 0)) {
        throw new Error("Workspace fixture content precedes its file header");
      }

      lines = [];
      return;
    }

    if (files.has(path)) {
      throw new Error("Workspace fixture repeats file " + path);
    }

    files.set(path, parse_fixture(lines.join("\n")));
    lines = [];
  };

  for (const line of text.split("\n")) {
    const header = /^\/\/-\s+(.+\.ix)\s*$/.exec(line);

    if (header === null) {
      lines.push(line);
      continue;
    }

    flush();
    path = header[1];

    if (path === undefined || path.includes("..")) {
      throw new Error("Invalid workspace fixture file path");
    }
  }

  flush();

  if (files.size === 0) {
    throw new Error("Workspace fixture has no files");
  }

  return { files };
}

export async function materialize_workspace_fixture(
  fixture: WorkspaceFixture,
  root: string,
): Promise<Map<string, string>> {
  const uris = new Map<string, string>();

  for (const [fixture_path, file] of fixture.files) {
    let relative = fixture_path;

    if (fixture_path.startsWith("/")) {
      relative = fixture_path.slice(1);
    }

    const path = root + "/" + relative;
    const separator = path.lastIndexOf("/");

    if (separator < 0) {
      throw new Error("Workspace fixture path has no directory");
    }

    await Deno.mkdir(path.slice(0, separator), { recursive: true });
    await Deno.writeTextFile(path, file.source);
    uris.set(fixture_path, new URL("file://" + path).href);
  }

  return uris;
}

type Marker = {
  character: number;
  length: number;
  label: string;
};

function parse_marker(line: string): Marker | undefined {
  const match = line.match(/^(\s*\/\/)(\s*)(\^+)(?:\s+(.+?))?\s*$/);

  if (match === null) {
    return undefined;
  }

  const prefix = match[1];
  const padding = match[2];
  const carets = match[3];
  const label = match[4];

  if (
    prefix === undefined || padding === undefined || carets === undefined ||
    label === undefined
  ) {
    throw new Error("Fixture marker needs a span name or expectation");
  }

  return {
    character: Math.max(0, prefix.length + padding.length - 2),
    length: carets.length,
    label,
  };
}

export function golden_snapshot(value: unknown): string {
  return Deno.inspect(value, { compact: false, depth: 100, sorted: true }) +
    "\n";
}

export function assert_golden(actual: unknown, expected: string): void {
  assert_equals(golden_snapshot(actual), expected);
}

export async function assert_golden_file(
  path: string | URL,
  actual: unknown,
): Promise<void> {
  assert_golden(actual, await Deno.readTextFile(path));
}

export function decode_lsp_session(chunks: Iterable<Uint8Array>): unknown[] {
  const decoder = new MessageDecoder();
  const messages: unknown[] = [];

  for (const chunk of chunks) {
    messages.push(...decoder.push(chunk));
  }

  return messages;
}

export class LspTestClient {
  #finished = false;
  #stderr: Promise<Uint8Array>;
  #stdout: Promise<Uint8Array>;
  #writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(readonly child: Deno.ChildProcess) {
    this.#writer = child.stdin.getWriter();
    this.#stdout = read_all(child.stdout);
    this.#stderr = read_all(child.stderr);
  }

  async send(message: unknown): Promise<void> {
    this.ensure_open();
    await this.#writer.write(encode_message(message));
  }

  async send_fragmented(
    message: unknown,
    fragment_lengths: readonly number[],
  ): Promise<void> {
    this.ensure_open();
    const framed = encode_message(message);
    let start = 0;

    for (const length of fragment_lengths) {
      if (!Number.isInteger(length) || length <= 0) {
        throw new Error("Fragment length must be a positive integer");
      }

      if (start >= framed.length) {
        throw new Error("Fragment lengths exceed framed message length");
      }

      const end = Math.min(framed.length, start + length);
      await this.#writer.write(framed.slice(start, end));
      start = end;
    }

    if (start < framed.length) {
      await this.#writer.write(framed.slice(start));
    }
  }

  async finish(): Promise<LspSessionResult> {
    this.ensure_open();
    this.#finished = true;
    await this.#writer.close();
    const [status, stdout, stderr] = await Promise.all([
      this.child.status,
      this.#stdout,
      this.#stderr,
    ]);

    return {
      code: status.code,
      success: status.success,
      stderr,
      messages: decode_lsp_session([stdout]),
    };
  }

  async disconnect(): Promise<LspSessionResult> {
    return await this.finish();
  }

  ensure_open(): void {
    if (this.#finished) {
      throw new Error("LSP test client session is already closed");
    }
  }
}

export type LspSessionResult = {
  code: number;
  success: boolean;
  stderr: Uint8Array;
  messages: unknown[];
};

async function read_all(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
    length += result.value.length;
  }

  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}
