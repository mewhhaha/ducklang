import { expect } from "../expect.ts";

export type PositionEncoding = "utf-16" | "utf-8";

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type TextOffsets = {
  start: number;
  end: number;
};

export class PositionIndex {
  readonly #text: string;
  readonly #encoding: PositionEncoding;
  readonly #lines: TextLine[];

  constructor(text: string, encoding: PositionEncoding) {
    this.#text = text;
    this.#encoding = encoding;
    this.#lines = lines_of(text);
  }

  offset_from_position(position: LspPosition): number {
    expect_position(position);
    const line = this.#lines[position.line];
    expect(line !== undefined, "position line is outside the document");
    const content = this.#text.slice(line.start, line.end);
    const relative_offset = offset_in_line(
      content,
      position.character,
      this.#encoding,
    );
    return line.start + relative_offset;
  }

  position_from_offset(offset: number): LspPosition {
    expect(Number.isInteger(offset), "offset must be an integer");
    expect(
      offset >= 0 && offset <= this.#text.length,
      "offset is outside the document",
    );
    expect(
      !splits_surrogate_pair(this.#text, offset),
      "offset splits a surrogate pair",
    );
    expect(
      !is_inside_crlf(this.#text, offset),
      "offset is inside a CRLF line terminator",
    );

    let low = 0;
    let high = this.#lines.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const line = this.#lines[middle];
      expect(line !== undefined, "line is missing");

      if (offset < line.start) {
        high = middle - 1;
        continue;
      }

      if (offset > line.end) {
        low = middle + 1;
        continue;
      }

      const prefix = this.#text.slice(line.start, offset);
      return {
        line: middle,
        character: encoded_length(prefix, this.#encoding),
      };
    }

    throw new Error("offset is inside a line terminator");
  }

  offsets_from_range(range: LspRange): TextOffsets {
    const start = this.offset_from_position(range.start);
    const end = this.offset_from_position(range.end);
    expect(start <= end, "range end precedes range start");
    return { start, end };
  }
}

// Offsets are JavaScript string indices. Positions count either UTF-16 code
// units or UTF-8 bytes, but never permit an endpoint inside a scalar value.
export function offset_from_position(
  text: string,
  position: LspPosition,
  encoding: PositionEncoding,
): number {
  return new PositionIndex(text, encoding).offset_from_position(position);
}

export function position_from_offset(
  text: string,
  offset: number,
  encoding: PositionEncoding,
): LspPosition {
  return new PositionIndex(text, encoding).position_from_offset(offset);
}

export function offsets_from_range(
  text: string,
  range: LspRange,
  encoding: PositionEncoding,
): TextOffsets {
  return new PositionIndex(text, encoding).offsets_from_range(range);
}

export function encoded_length(
  text: string,
  encoding: PositionEncoding,
): number {
  let length = 0;

  for (let offset = 0; offset < text.length;) {
    const width = scalar_width(text, offset);

    if (encoding === "utf-16") {
      length += width;
    } else {
      length += utf8_width(text, offset, width);
    }

    offset += width;
  }

  return length;
}

function offset_in_line(
  line: string,
  character: number,
  encoding: PositionEncoding,
): number {
  let encoded = 0;
  let offset = 0;

  while (offset < line.length) {
    if (encoded === character) {
      return offset;
    }

    const width = scalar_width(line, offset);
    if (encoding === "utf-16") {
      encoded += width;
    } else {
      encoded += utf8_width(line, offset, width);
    }
    offset += width;
  }

  expect(encoded === character, "position character is outside the line");
  return offset;
}

type TextLine = {
  start: number;
  end: number;
};

function lines_of(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  let offset = 0;

  while (offset < text.length) {
    const character = text[offset];

    if (character !== "\r" && character !== "\n") {
      offset += 1;
      continue;
    }

    lines.push({ start, end: offset });

    if (character === "\r" && text[offset + 1] === "\n") {
      offset += 2;
    } else {
      offset += 1;
    }

    start = offset;
  }

  lines.push({ start, end: text.length });
  return lines;
}

function expect_position(position: LspPosition): void {
  expect(Number.isInteger(position.line), "position line must be an integer");
  expect(
    Number.isInteger(position.character),
    "position character must be an integer",
  );
  expect(position.line >= 0, "position line must not be negative");
  expect(position.character >= 0, "position character must not be negative");
}

function scalar_width(text: string, offset: number): number {
  const first = text.charCodeAt(offset);

  if (first >= 0xd800 && first <= 0xdbff && offset + 1 < text.length) {
    const second = text.charCodeAt(offset + 1);

    if (second >= 0xdc00 && second <= 0xdfff) {
      return 2;
    }
  }

  return 1;
}

function splits_surrogate_pair(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) {
    return false;
  }

  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 &&
    after <= 0xdfff;
}

function is_inside_crlf(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) {
    return false;
  }

  return text[offset - 1] === "\r" && text[offset] === "\n";
}

function utf8_width(text: string, offset: number, width: number): number {
  const first = text.charCodeAt(offset);

  if (width === 2) {
    return 4;
  }

  if (first <= 0x7f) {
    return 1;
  }

  if (first <= 0x7ff) {
    return 2;
  }

  // TextEncoder replaces an unpaired surrogate with U+FFFD, which is three
  // bytes in UTF-8. Treating it this way keeps offsets compatible with JS.
  return 3;
}
