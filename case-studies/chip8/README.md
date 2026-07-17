# CHIP-8 Case Study

This directory contains a deterministic, bounded CHIP-8 execution core written
in Duck. It also exposes the core as managed named callables, so a host can
drive one instruction at a time or run a bounded batch.

The machine is one owned `Bytes` value. Its 4 KiB memory, 16 byte registers,
64×32 monochrome framebuffer, 16-entry return stack, program counter, index
register, timers, key mask, and cycle counter occupy explicit offsets in that
buffer. The Duck exports are pure state transitions:

- `initialize: [Bytes, I32] -> Bytes` sets the program counter and key mask.
- `step: [Bytes, I32] -> Bytes` executes one instruction and applies an optional
  timer tick.
- `run: [Bytes, I32, I32] -> Bytes` repeats `step` for an exact count.
- `read: [Bytes, I32] -> I32` consumes a finished state to read one summary
  field.

The JavaScript adapter creates a fresh fixture buffer for every run, then
threads each resulting `DuckStateToken` through `initialize`, `step`, and `run`.
Moving a token consumes the prior token; no JavaScript object aliases or mutates
the Duck machine. Disposing the final token returns its Wasm allocation to the
managed ABI allocator, which can reuse that backend-owned memory.

ROM fixtures intentionally live at this host boundary. Managed callables cannot
capture module constants or allocate a returned `Bytes` value under the current
compiler ownership proof, while a host-provided `Bytes` state has the exact
move-only contract needed by the emulator. The opcode decoder remains wholly in
Duck.

## Instruction subset

The decoder implements:

- clear and return: `00E0`, `00EE`;
- jump, call, and offset jump: `1NNN`, `2NNN`, `BNNN`;
- conditional skips: `3XNN`, `4XNN`, `5XY0`, `9XY0`, `EX9E`, `EXA1`;
- loads and arithmetic: `6XNN`, `7XNN`, `8XY0`, `8XY4`, `8XY5`, `8XY7`;
- bitwise and shifts: `8XY1`, `8XY2`, `8XY3`, `8XY6`, `8XYE`;
- index and XOR sprite drawing: `ANNN`, `DXYN`;
- timers and keys: `FX07`, `FX0A`, `FX15`, `FX18`;
- memory operations: `FX1E`, `FX33`, `FX55`, `FX65`.

Shifts use the modern `VX` convention. Drawing wraps at both screen edges.
Timers are deterministic: a positive `timer_period` decrements both timers after
each matching instruction count. `FX0A` chooses the lowest set bit in the 16-bit
key mask and repeats at the same program counter when the mask is empty.
Unsupported opcodes currently behave as no-ops after the normal two-byte fetch.

## Fixtures

- `alu` covers load, arithmetic, carry, bitwise operations, shifts, skips,
  call/return, and jump.
- `draw` writes a five-row sprite to memory, draws it, and draws it again to
  exercise XOR collision behavior.
- `timers` covers delay/sound timers, pressed/not-pressed skips, and wait-key.
- `memory` covers BCD and register store/load instructions.

## Run tests

The tests require `wat2wasm` on `PATH`:

```sh
deno test --no-check --allow-read --allow-run \
  case-studies/chip8/chip8.test.ts
```
