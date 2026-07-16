import { assert_equals } from "../../src/assert.ts";
import { render } from "./raytracer.ts";

const decoder = new TextDecoder();

Deno.test("ray tracer renders a fixed P6 PPM image", async () => {
  const ppm = await render();

  assert_equals(decoder.decode(ppm.slice(0, 13)), "P6\n32 20\n255\n");
  assert_equals(ppm.length, 1933);
  assert_equals(checksum(ppm), 210999809);
});

function checksum(bytes: Uint8Array): number {
  let value = 2166136261;

  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 16777619);
  }

  return value >>> 0;
}
