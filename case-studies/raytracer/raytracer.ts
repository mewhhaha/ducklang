import { DuckHost, type DuckValue, Source } from "../../src/frontend.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source_url = new URL("./raytracer.duck", import.meta.url);

export async function render(): Promise<Uint8Array> {
  const artifact = Source.artifact_file(source_url.href);
  const wasm = await wasm_from_wat(artifact.wat);
  const program = await DuckHost.instantiate(wasm, artifact.abi);

  try {
    return decode_ppm(program.run());
  } finally {
    program.dispose();
  }
}

function decode_ppm(value: DuckValue): Uint8Array {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("ray tracer module must return a one-slot product");
  }

  const ppm = value[0];

  if (!(ppm instanceof Uint8Array)) {
    throw new Error("ray tracer module PPM export must be Bytes");
  }

  return ppm;
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

if (import.meta.main) {
  await Deno.stdout.write(await render());
}
