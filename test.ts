#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
const decoder = new TextDecoder();

function arg(index: number, fallback: string): string {
  const value = Deno.args[index];

  if (value === undefined) {
    return fallback;
  }

  return value;
}

const mainFile = arg(0, "main.ts");
const watFile = arg(1, "build/out.wat");
const wasmFile = arg(2, "build/out.wasm");

await Deno.mkdir("build", { recursive: true });

function logError(label: string, bytes: Uint8Array) {
  if (bytes.length > 0) {
    console.error(`${label}:\n${decoder.decode(bytes)}`);
  }
}

const runMain = await new Deno.Command(Deno.execPath(), {
  args: ["run", "--allow-read", "--allow-write", mainFile],
  stdout: "piped",
  stderr: "piped",
}).output();

if (!runMain.success) {
  logError("main.ts failed", runMain.stderr);
  Deno.exit(runMain.code);
}

const generatedWatFile = "build/out.wat";

try {
  await Deno.stat(generatedWatFile);
} catch {
  console.error(`main.ts did not write ${generatedWatFile}.`);
  Deno.exit(1);
}

if (generatedWatFile !== watFile) {
  await Deno.copyFile(generatedWatFile, watFile);
}

console.log(`wrote ${watFile}`);

const compile = await new Deno.Command("wat2wasm", {
  args: [watFile, "-o", wasmFile],
  stdout: "piped",
  stderr: "piped",
}).output();

if (compile.stderr.length > 0) {
  logError("wat2wasm stderr", compile.stderr);
}

if (!compile.success) {
  Deno.exit(compile.code);
}

console.log(`wrote ${wasmFile}`);

const wasmBytes = await Deno.readFile(wasmFile);
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
console.log("compiled wasm module and instantiated successfully");

const exports = Object.entries(instance.exports).map(([name, value]) => ({
  name,
  type: typeof value,
}));
console.log("exports:", exports);

if (
  "_start" in instance.exports && typeof instance.exports._start === "function"
) {
  console.log("running _start()");
  try {
    (instance.exports._start as CallableFunction)();
  } catch (error) {
    console.error("error running _start", error);
    Deno.exit(1);
  }
} else if (
  "main" in instance.exports && typeof instance.exports.main === "function"
) {
  console.log("running main()");
  try {
    const result = (instance.exports.main as CallableFunction)();
    if (typeof result !== "undefined") {
      console.log("main() ->", result);
    }
  } catch (error) {
    console.error("error running main", error);
    Deno.exit(1);
  }
} else {
  console.log("no _start or main export to execute");
}
