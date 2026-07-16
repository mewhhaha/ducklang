import { assert_equals } from "../../src/assert.ts";
import { render_wav } from "./wav.ts";

Deno.test("WAV case study emits a PCM RIFF header with the expected length", async () => {
  const wav = await render_wav();

  assert_equals(wav.length, 16044);
  assert_equals(Array.from(wav.slice(0, 4)), [0x52, 0x49, 0x46, 0x46]);
  assert_equals(read_u32_le(wav, 4), 16036);
  assert_equals(Array.from(wav.slice(8, 12)), [0x57, 0x41, 0x56, 0x45]);
  assert_equals(Array.from(wav.slice(12, 16)), [0x66, 0x6d, 0x74, 0x20]);
  assert_equals(read_u32_le(wav, 16), 16);
  assert_equals(read_u16_le(wav, 20), 1);
  assert_equals(read_u16_le(wav, 22), 1);
  assert_equals(read_u32_le(wav, 24), 8000);
  assert_equals(read_u32_le(wav, 28), 16000);
  assert_equals(read_u16_le(wav, 32), 2);
  assert_equals(read_u16_le(wav, 34), 16);
  assert_equals(Array.from(wav.slice(36, 40)), [0x64, 0x61, 0x74, 0x61]);
  assert_equals(read_u32_le(wav, 40), 16000);
});

Deno.test("WAV case study produces deterministic layered PCM samples", async () => {
  const first = await render_wav();
  const second = await render_wav();

  assert_equals(first, second);
  assert_equals(pcm_sample(first, 0), 13000);
  assert_equals(pcm_sample(first, 15), -5000);
  assert_equals(pcm_sample(first, 999), 13000);
  assert_equals(pcm_sample(first, 1000), -5000);
  assert_equals(pcm_sample(first, 7999), -13000);
  assert_equals(fnv1a(first), 3353846728);
});

function read_u16_le(bytes: Uint8Array, offset: number): number {
  const low = bytes[offset];
  const high = bytes[offset + 1];

  if (low === undefined || high === undefined) {
    throw new Error("Missing WAV u16 at offset " + offset.toString());
  }

  return low | (high << 8);
}

function read_u32_le(bytes: Uint8Array, offset: number): number {
  const low = read_u16_le(bytes, offset);
  const high = read_u16_le(bytes, offset + 2);
  return low + high * 0x1_0000;
}

function pcm_sample(bytes: Uint8Array, sample_index: number): number {
  const unsigned = read_u16_le(bytes, 44 + sample_index * 2);

  if (unsigned >= 0x8000) {
    return unsigned - 0x1_0000;
  }

  return unsigned;
}

function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
