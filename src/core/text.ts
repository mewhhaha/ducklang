import { expect } from "../expect.ts";

const text_encoder = new TextEncoder();

export function text_bytes(value: string): number[] {
  const encoded = text_encoder.encode(value);
  const bytes = u32_le(encoded.length);

  for (const byte of encoded) {
    bytes.push(byte);
  }

  return bytes;
}

export function text_byte_length(value: string): number {
  return text_encoder.encode(value).length;
}

export function text_content_bytes(value: string): number[] {
  return Array.from(text_encoder.encode(value));
}

export function align_to_4(value: number): number {
  let aligned = value;

  while (aligned % 4 !== 0) {
    aligned += 1;
  }

  return aligned;
}

function u32_le(value: number): number[] {
  expect(Number.isInteger(value), "Text byte length must be an integer");
  expect(value >= 0, "Text byte length must be non-negative");
  expect(value <= 0xffffffff, "Text byte length is too large");

  const bytes: number[] = [];
  let rest = value;

  for (let index = 0; index < 4; index += 1) {
    bytes.push(rest % 256);
    rest = Math.floor(rest / 256);
  }

  return bytes;
}
