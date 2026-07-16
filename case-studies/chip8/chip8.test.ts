import { assert_equals, assert_throws } from "../../src/assert.ts";
import { Source } from "../../src/frontend.ts";
import {
  initialize_chip8,
  instantiate_chip8,
  read_chip8_field,
  run_chip8,
  run_chip8_steps,
  step_chip8,
} from "./chip8.ts";

const source_url = new URL("./chip8.duck", import.meta.url);

Deno.test("CHIP-8 case study exports move-only machine callables", () => {
  const artifact = Source.artifact_file(source_url.href);

  assert_equals(artifact.abi.effects, {});
  assert_equals(artifact.abi.callables, {
    initialize: {
      name: "initialize",
      export: "__duck_abi_call_initialize",
      params: [
        { type: { tag: "bytes" }, ownership: "move" },
        { type: { tag: "i32" }, ownership: "scalar" },
      ],
      result: { type: { tag: "bytes" }, ownership: "move" },
    },
    step: {
      name: "step",
      export: "__duck_abi_call_step",
      params: [
        { type: { tag: "bytes" }, ownership: "move" },
        { type: { tag: "i32" }, ownership: "scalar" },
      ],
      result: { type: { tag: "bytes" }, ownership: "move" },
    },
    run: {
      name: "run",
      export: "__duck_abi_call_run",
      params: [
        { type: { tag: "bytes" }, ownership: "move" },
        { type: { tag: "i32" }, ownership: "scalar" },
        { type: { tag: "i32" }, ownership: "scalar" },
      ],
      result: { type: { tag: "bytes" }, ownership: "move" },
    },
    read: {
      name: "read",
      export: "__duck_abi_call_read",
      params: [
        { type: { tag: "bytes" }, ownership: "move" },
        { type: { tag: "i32" }, ownership: "scalar" },
      ],
      result: { type: { tag: "i32" }, ownership: "scalar" },
    },
  });
});

Deno.test("CHIP-8 host threads interactive state through step and run", async () => {
  const program = await instantiate_chip8();

  try {
    const initial = initialize_chip8(program, "alu", 0);
    const after_step = step_chip8(program, initial, 0);

    assert_throws(
      () => program.call("step", [initial, 0]),
      "State token is no longer live",
    );

    const after_run = run_chip8_steps(program, after_step, 3, 0);

    assert_equals(read_chip8_field(program, after_run, "cycles"), 4);
  } finally {
    program.dispose();
  }
});

Deno.test("CHIP-8 state token disposes its backend-owned machine buffer once", async () => {
  const program = await instantiate_chip8();

  try {
    const alloc = program.instance.exports.__duck_abi_alloc;
    const free = program.instance.exports.__duck_abi_free;

    if (typeof alloc !== "function" || typeof free !== "function") {
      throw new Error("CHIP-8 ABI allocator exports are missing");
    }

    const initial = initialize_chip8(program, "draw", 0);
    const after_step = step_chip8(program, initial, 0);
    after_step.dispose();
    assert_throws(() => after_step.dispose(), "State token is no longer live");

    const reusable = alloc(6209, 8);

    if (reusable <= 0) {
      throw new Error("CHIP-8 ABI allocator returned an invalid pointer");
    }

    free(reusable);
  } finally {
    program.dispose();
  }
});

Deno.test("CHIP-8 executes ALU, bitwise, shifts, skips, call, return, and jump", async () => {
  const summary = await run_chip8({ fixture: "alu", max_steps: 18 });

  assert_equals(summary.pc, 0x230);
  assert_equals(summary.stack_pointer, 0);
  assert_equals(summary.cycles, 18);
  assert_equals(summary.register_checksum, 30);
  assert_equals([summary.v0, summary.v1, summary.v2, summary.vf], [3, 3, 7, 0]);
});

Deno.test("CHIP-8 draws a wrapping XOR sprite and reports its checksum", async () => {
  const summary = await run_chip8({ fixture: "draw", max_steps: 10 });

  assert_equals(summary.pc, 0x214);
  assert_equals(summary.index, 0x300);
  assert_equals(summary.lit_pixels, 16);
  assert_equals(summary.framebuffer_checksum, 2088);
  assert_equals(summary.register_checksum, 2496);
  assert_equals(summary.vf, 0);
});

Deno.test("CHIP-8 repeated draw clears pixels and raises collision", async () => {
  const summary = await run_chip8({ fixture: "draw", max_steps: 11 });

  assert_equals(summary.pc, 0x216);
  assert_equals(summary.lit_pixels, 0);
  assert_equals(summary.framebuffer_checksum, 0);
  assert_equals(summary.register_checksum, 2512);
  assert_equals(summary.vf, 1);
});

Deno.test("CHIP-8 ticks timers and reads the lowest pressed key", async () => {
  const summary = await run_chip8({
    fixture: "timers",
    max_steps: 9,
    key_mask: 1 << 0xa,
    timer_period: 2,
  });

  assert_equals(summary.pc, 0x214);
  assert_equals(summary.delay_timer, 0);
  assert_equals(summary.sound_timer, 0);
  assert_equals(summary.register_checksum, 53);
  assert_equals([summary.v0, summary.v1, summary.v2], [3, 10, 10]);
});

Deno.test("CHIP-8 wait-for-key repeats its instruction when no key is pressed", async () => {
  const summary = await run_chip8({
    fixture: "timers",
    max_steps: 9,
    timer_period: 2,
  });

  assert_equals(summary.pc, 0x212);
  assert_equals(summary.register_checksum, 35);
  assert_equals([summary.v0, summary.v1, summary.v2], [15, 10, 0]);
});

Deno.test("CHIP-8 stores BCD and transfers registers through memory", async () => {
  const summary = await run_chip8({ fixture: "memory", max_steps: 13 });

  assert_equals(summary.pc, 0x21a);
  assert_equals(summary.index, 0x310);
  assert_equals(summary.register_checksum, 14);
  assert_equals([summary.v0, summary.v1, summary.v2], [1, 2, 3]);
});
