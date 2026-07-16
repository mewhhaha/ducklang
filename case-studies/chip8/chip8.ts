import {
  DuckHost,
  type DuckHostInstance,
  type DuckStateToken,
  type DuckValue,
  Source,
} from "../../src/frontend.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source_url = new URL("./chip8.duck", import.meta.url);

export type Chip8Fixture = "alu" | "draw" | "timers" | "memory";

export type Chip8Run = {
  fixture: Chip8Fixture;
  max_steps: number;
  key_mask?: number;
  timer_period?: number;
};

export type Chip8Summary = {
  pc: number;
  index: number;
  stack_pointer: number;
  delay_timer: number;
  sound_timer: number;
  cycles: number;
  register_checksum: number;
  framebuffer_checksum: number;
  lit_pixels: number;
  v0: number;
  v1: number;
  v2: number;
  vf: number;
};

type Chip8SummaryField = keyof Chip8Summary;

const state_size = 6205;
const rom_offset = 0x200;

const roms: Record<Chip8Fixture, Uint8Array> = {
  alu: Uint8Array.from([
    0x60,
    0xfe,
    0x61,
    0x03,
    0x80,
    0x14,
    0x80,
    0x11,
    0x80,
    0x12,
    0x80,
    0x13,
    0x60,
    0x03,
    0x80,
    0x0e,
    0x80,
    0x06,
    0x30,
    0x03,
    0x60,
    0xff,
    0x40,
    0x04,
    0x60,
    0xee,
    0x50,
    0x10,
    0x60,
    0xdd,
    0x90,
    0x10,
    0x22,
    0x2a,
    0x12,
    0x2e,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x72,
    0x05,
    0x00,
    0xee,
    0x72,
    0x02,
  ]),
  draw: Uint8Array.from([
    0x60,
    0xf0,
    0x61,
    0x90,
    0x62,
    0xf0,
    0x63,
    0x90,
    0x64,
    0xf0,
    0xa3,
    0x00,
    0xf4,
    0x55,
    0x60,
    0x00,
    0x61,
    0x00,
    0xd0,
    0x15,
    0xd0,
    0x15,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]),
  timers: Uint8Array.from([
    0x60,
    0x03,
    0xf0,
    0x15,
    0xf0,
    0x18,
    0xf0,
    0x07,
    0x61,
    0x0a,
    0xe1,
    0x9e,
    0x60,
    0x0f,
    0xe1,
    0xa1,
    0x70,
    0x01,
    0xf2,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]),
  memory: Uint8Array.from([
    0x60,
    0x7b,
    0xa3,
    0x00,
    0xf0,
    0x33,
    0x60,
    0x00,
    0x61,
    0x00,
    0x62,
    0x00,
    0xf2,
    0x65,
    0xa3,
    0x10,
    0xf2,
    0x55,
    0x60,
    0x00,
    0x61,
    0x00,
    0x62,
    0x00,
    0xf2,
    0x65,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]),
};

const summary_fields: Chip8SummaryField[] = [
  "pc",
  "index",
  "stack_pointer",
  "delay_timer",
  "sound_timer",
  "cycles",
  "register_checksum",
  "framebuffer_checksum",
  "lit_pixels",
  "v0",
  "v1",
  "v2",
  "vf",
];

export async function instantiate_chip8(): Promise<DuckHostInstance> {
  const artifact = Source.artifact_file(source_url.href);
  const wasm = await wasm_from_wat(artifact.wat);
  return DuckHost.instantiate(wasm, artifact.abi);
}

export function initialize_chip8(
  program: DuckHostInstance,
  fixture: Chip8Fixture,
  key_mask: number,
): DuckStateToken {
  return state_token(
    program.call("initialize", [machine_bytes(fixture), key_mask]),
  );
}

export function step_chip8(
  program: DuckHostInstance,
  state: DuckStateToken,
  timer_period: number,
): DuckStateToken {
  return state_token(program.call("step", [state, timer_period]));
}

export function run_chip8_steps(
  program: DuckHostInstance,
  state: DuckStateToken,
  max_steps: number,
  timer_period: number,
): DuckStateToken {
  return state_token(program.call("run", [state, max_steps, timer_period]));
}

export function read_chip8_field(
  program: DuckHostInstance,
  state: DuckStateToken,
  field: Chip8SummaryField,
): number {
  const field_index = summary_fields.indexOf(field);

  if (field_index < 0) {
    throw new Error("Unknown CHIP-8 summary field: " + field);
  }

  const value = program.call("read", [state, field_index]);

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("CHIP-8 summary field " + field + " must be an integer");
  }

  return value;
}

export async function run_chip8(config: Chip8Run): Promise<Chip8Summary> {
  const program = await instantiate_chip8();
  let key_mask = 0;
  let timer_period = 0;

  if (config.key_mask !== undefined) {
    key_mask = config.key_mask;
  }

  if (config.timer_period !== undefined) {
    timer_period = config.timer_period;
  }

  try {
    const result: Partial<Chip8Summary> = {};

    for (const field of summary_fields) {
      let state = initialize_chip8(program, config.fixture, key_mask);
      state = run_chip8_steps(program, state, config.max_steps, timer_period);
      result[field] = read_chip8_field(program, state, field);
    }

    return complete_summary(result);
  } finally {
    program.dispose();
  }
}

function complete_summary(value: Partial<Chip8Summary>): Chip8Summary {
  return {
    pc: summary_field(value, "pc"),
    index: summary_field(value, "index"),
    stack_pointer: summary_field(value, "stack_pointer"),
    delay_timer: summary_field(value, "delay_timer"),
    sound_timer: summary_field(value, "sound_timer"),
    cycles: summary_field(value, "cycles"),
    register_checksum: summary_field(value, "register_checksum"),
    framebuffer_checksum: summary_field(value, "framebuffer_checksum"),
    lit_pixels: summary_field(value, "lit_pixels"),
    v0: summary_field(value, "v0"),
    v1: summary_field(value, "v1"),
    v2: summary_field(value, "v2"),
    vf: summary_field(value, "vf"),
  };
}

function summary_field(
  summary: Partial<Chip8Summary>,
  name: Chip8SummaryField,
): number {
  const value = summary[name];

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("CHIP-8 summary field " + name + " must be an integer");
  }

  return value;
}

function machine_bytes(fixture: Chip8Fixture): Uint8Array {
  const rom = roms[fixture];

  if (!rom) {
    throw new Error("Unknown CHIP-8 fixture: " + fixture);
  }

  const state = new Uint8Array(state_size);
  state.set(rom, rom_offset);
  return state;
}

function state_token(value: DuckValue | DuckStateToken): DuckStateToken {
  if (
    typeof value !== "object" || value === null || !("dispose" in value) ||
    typeof value.dispose !== "function"
  ) {
    throw new Error("CHIP-8 callable must return a state token");
  }

  return value as DuckStateToken;
}

async function wasm_from_wat(wat: string): Promise<Uint8Array> {
  const command = new Deno.Command("wat2wasm", {
    args: ["-o", "-", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = command.stdin.getWriter();
  await writer.write(encoder.encode(wat));
  await writer.close();
  const output = await command.output();

  if (!output.success) {
    throw new Error(
      "wat2wasm failed:\n" + decoder.decode(output.stderr) + "\n" + wat,
    );
  }

  return output.stdout;
}
