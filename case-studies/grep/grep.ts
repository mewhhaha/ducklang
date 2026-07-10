import { IxHost, type IxValue, Source } from "../../src/frontend.ts";
import { type GrepRunner, live_runner } from "./host.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source_url = new URL("./grep.ix", import.meta.url);
const host_interface_url = new URL("./host.ix", import.meta.url);

export type GrepResult = {
  code: number;
};

export async function main(runner: GrepRunner): Promise<GrepResult> {
  const artifact = Source.artifact_file(source_url.href, {
    host_interface: host_interface_url.href,
  });
  const wasm = await wasm_from_wat(artifact.wat);
  const program = await IxHost.instantiate(wasm, artifact.abi);

  try {
    return decode_result(runner.run(program));
  } finally {
    program.dispose();
  }
}

function decode_result(value: IxValue): GrepResult {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    value instanceof Uint8Array
  ) {
    throw new Error("grep module must return a result record");
  }

  if (!("code" in value)) {
    throw new Error("grep module result is missing code");
  }

  const code = value.code;

  if (typeof code !== "number" || !Number.isInteger(code)) {
    throw new Error("grep module result code must be an integer");
  }

  return { code };
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
  const runner = live_runner(Deno.args);

  try {
    const result = await main(runner);
    Deno.exitCode = result.code;
  } finally {
    runner.dispose();
  }
}
