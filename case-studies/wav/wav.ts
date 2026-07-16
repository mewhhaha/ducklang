import { DuckHost, type DuckValue, Source } from "../../src/frontend.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source_url = new URL("./wav.duck", import.meta.url);

export const default_output_path = "phrase.wav";

export async function render_wav(): Promise<Uint8Array> {
  const artifact = Source.artifact_file(source_url.href);
  const wasm = await wasm_from_wat(artifact.wat);
  const program = await DuckHost.instantiate(wasm, artifact.abi);

  try {
    return decode_wav(program.run());
  } finally {
    program.dispose();
  }
}

function decode_wav(value: DuckValue): Uint8Array {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("WAV module must return a one-slot product");
  }

  const wav = value[0];

  if (!(wav instanceof Uint8Array)) {
    throw new Error("WAV module export wav must be Bytes");
  }

  return wav;
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
  let output_path = default_output_path;

  if (Deno.args.length === 1) {
    const path = Deno.args[0];

    if (path === undefined) {
      throw new Error("Missing WAV output path");
    }

    output_path = path;
  } else if (Deno.args.length > 1) {
    throw new Error(
      "Usage: deno run --allow-read --allow-write --allow-run=wat2wasm " +
        "case-studies/wav/wav.ts [output.wav]",
    );
  }

  const wav = await render_wav();
  await Deno.writeFile(output_path, wav);
}
