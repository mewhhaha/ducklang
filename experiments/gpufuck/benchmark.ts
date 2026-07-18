import {
  compileFunctionalModuleToWasm,
  GpuFunctionalCompiler,
  type GpuFunctionalModule,
  requestWebGpuDevice,
} from "../../../gpufuck/functional.ts";
import { Source } from "../../src/frontend.ts";
import { gpufuck_benchmark_cases } from "./benchmark_cases.ts";
import { encode_gpufuck_module } from "./compiler.ts";

type BenchmarkSource = {
  path: string;
  current_route: "ic" | "core";
  expected: number;
  text: string;
};

type CurrentMeasurement = {
  duck_compile_ms: number;
  wasm_emit_ms: number;
  total_ms: number;
  wat_bytes: number;
  wasm_bytes: number;
  modules: readonly Uint8Array<ArrayBuffer>[];
};

type GpufuckMeasurement = {
  duck_lower_and_encode_ms: number;
  gpu_compile_ms: number;
  wasm_emit_ms: number;
  total_ms: number;
  wasm_bytes: number;
  modules: readonly Uint8Array<ArrayBuffer>[];
};

const warmup_rounds = 2;
const measured_rounds = 20;
const scaling_rounds = 7;
const scaling_binding_counts = [100, 500, 1_000, 2_000];
const benchmark_sources: BenchmarkSource[] = [];

for (const benchmark_case of gpufuck_benchmark_cases) {
  benchmark_sources.push({
    ...benchmark_case,
    text: await Deno.readTextFile(benchmark_case.path),
  });
}

for (let round = 0; round < warmup_rounds; round += 1) {
  await compile_current_suite(benchmark_sources);
}

const compiler_start = performance.now();
const device = await requestWebGpuDevice();
let compiler: GpuFunctionalCompiler;

try {
  compiler = await GpuFunctionalCompiler.create(device);
} catch (error) {
  device.destroy();
  throw error;
}

const compiler_startup_ms = performance.now() - compiler_start;

try {
  const first_compile_start = performance.now();
  await compile_gpufuck_suite(compiler, benchmark_sources);
  const first_compile_ms = performance.now() - first_compile_start;

  for (let round = 1; round < warmup_rounds; round += 1) {
    await compile_gpufuck_suite(compiler, benchmark_sources);
  }

  const current_samples: CurrentMeasurement[] = [];
  const gpufuck_samples: GpufuckMeasurement[] = [];

  for (let round = 0; round < measured_rounds; round += 1) {
    current_samples.push(await compile_current_suite(benchmark_sources));
    gpufuck_samples.push(
      await compile_gpufuck_suite(compiler, benchmark_sources),
    );
  }

  const last_gpufuck_sample = gpufuck_samples[gpufuck_samples.length - 1];

  if (last_gpufuck_sample === undefined) {
    throw new Error("gpufuck benchmark did not produce a measured sample");
  }

  await verify_modules(last_gpufuck_sample.modules, benchmark_sources);
  const last_current_sample = current_samples[current_samples.length - 1];

  if (last_current_sample === undefined) {
    throw new Error("current benchmark did not produce a measured sample");
  }

  await verify_modules(last_current_sample.modules, benchmark_sources);

  const current_duck_compile_ms = median(
    current_samples.map((sample) => sample.duck_compile_ms),
  );
  const current_wasm_emit_ms = median(
    current_samples.map((sample) => sample.wasm_emit_ms),
  );
  const current_total_ms = median(
    current_samples.map((sample) => sample.total_ms),
  );
  const gpufuck_duck_lower_and_encode_ms = median(
    gpufuck_samples.map((sample) => sample.duck_lower_and_encode_ms),
  );
  const gpufuck_compile_ms = median(
    gpufuck_samples.map((sample) => sample.gpu_compile_ms),
  );
  const gpufuck_emit_ms = median(
    gpufuck_samples.map((sample) => sample.wasm_emit_ms),
  );
  const gpufuck_total_ms = median(
    gpufuck_samples.map((sample) => sample.total_ms),
  );
  const first_current_sample = current_samples[0];
  const first_gpufuck_sample = gpufuck_samples[0];

  if (
    first_current_sample === undefined || first_gpufuck_sample === undefined
  ) {
    throw new Error("compiler benchmark omitted artifact byte measurements");
  }

  const current_wat_bytes = first_current_sample.wat_bytes;
  const current_wasm_bytes = first_current_sample.wasm_bytes;
  const gpufuck_wasm_bytes = first_gpufuck_sample.wasm_bytes;

  const scaling = [];

  for (const binding_count of scaling_binding_counts) {
    const lines = ["let value0 = 0"];

    for (let index = 1; index <= binding_count; index += 1) {
      lines.push(
        "let value" + index.toString() + " = value" +
          (index - 1).toString() + " + 1",
      );
    }

    lines.push("value" + binding_count.toString());
    const source: BenchmarkSource = {
      path: "generated/" + binding_count.toString() + "-bindings.duck",
      current_route: "core",
      expected: binding_count,
      text: lines.join("\n"),
    };
    const sources = [source];
    await compile_current_suite(sources);
    await compile_gpufuck_suite(compiler, sources);
    const current_scaling_samples: CurrentMeasurement[] = [];
    const gpufuck_scaling_samples: GpufuckMeasurement[] = [];

    for (let round = 0; round < scaling_rounds; round += 1) {
      current_scaling_samples.push(await compile_current_suite(sources));
      gpufuck_scaling_samples.push(
        await compile_gpufuck_suite(compiler, sources),
      );
    }

    const last_sample = gpufuck_scaling_samples[scaling_rounds - 1];

    if (last_sample === undefined) {
      throw new Error(
        "gpufuck scaling benchmark omitted " + binding_count.toString() +
          "-binding sample",
      );
    }

    await verify_modules(last_sample.modules, sources);
    const last_current_scaling_sample =
      current_scaling_samples[scaling_rounds - 1];

    if (last_current_scaling_sample === undefined) {
      throw new Error(
        "current scaling benchmark omitted " + binding_count.toString() +
          "-binding sample",
      );
    }

    await verify_modules(last_current_scaling_sample.modules, sources);
    const current_ms = median(
      current_scaling_samples.map((sample) => sample.total_ms),
    );
    const gpufuck_ms = median(
      gpufuck_scaling_samples.map((sample) => sample.total_ms),
    );
    scaling.push({
      bindings: binding_count,
      source_bytes: new TextEncoder().encode(source.text).byteLength,
      current_ms,
      gpufuck_ms,
      gpufuck_over_current: gpufuck_ms / current_ms,
    });
  }

  console.log(JSON.stringify(
    {
      suite: {
        examples: benchmark_sources.length,
        warmup_rounds,
        measured_rounds,
        scaling_rounds,
        paths: benchmark_sources.map((source) => source.path),
      },
      before: {
        compiler: "current IC/Core routes",
        median_duck_compile_ms: current_duck_compile_ms,
        median_wasm_emit_ms: current_wasm_emit_ms,
        median_total_ms: current_total_ms,
        wat_bytes: current_wat_bytes,
        wasm_bytes: current_wasm_bytes,
      },
      after: {
        compiler: "experimental gpufuck route",
        startup_ms: compiler_startup_ms,
        first_compile_ms,
        median_duck_lower_and_encode_ms: gpufuck_duck_lower_and_encode_ms,
        median_gpu_compile_ms: gpufuck_compile_ms,
        median_wasm_emit_ms: gpufuck_emit_ms,
        median_total_ms: gpufuck_total_ms,
        wasm_bytes: gpufuck_wasm_bytes,
      },
      comparison: {
        warm_compile_speedup: current_total_ms / gpufuck_total_ms,
        warm_compile_change_percent: (gpufuck_total_ms - current_total_ms) /
          current_total_ms * 100,
      },
      scaling,
    },
    undefined,
    2,
  ));
} finally {
  device.destroy();
}

async function compile_current_suite(
  sources: readonly BenchmarkSource[],
): Promise<CurrentMeasurement> {
  const total_start = performance.now();
  const duck_compile_start = performance.now();
  let wat_bytes = 0;
  const wat_modules: string[] = [];

  for (const source of sources) {
    let wat: string;

    if (source.current_route === "ic") {
      wat = Source.ic_wat(source.text);
    } else {
      wat = Source.wat(source.text);
    }

    wat_bytes += new TextEncoder().encode(wat).byteLength;
    wat_modules.push(wat);
  }

  const duck_compile_ms = performance.now() - duck_compile_start;
  const wasm_emit_start = performance.now();
  const modules = await Promise.all(wat_modules.map(wasm_from_wat));
  const wasm_emit_ms = performance.now() - wasm_emit_start;
  let wasm_bytes = 0;

  for (const module of modules) {
    wasm_bytes += module.byteLength;
  }

  return {
    duck_compile_ms,
    wasm_emit_ms,
    total_ms: performance.now() - total_start,
    wat_bytes,
    wasm_bytes,
    modules,
  };
}

async function wasm_from_wat(
  wat: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const process = new Deno.Command("wat2wasm", {
    args: ["-", "-o", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(wat));
  await writer.close();
  const output = await process.output();

  if (!output.success) {
    throw new Error(
      "wat2wasm failed during compiler benchmark:\n" +
        new TextDecoder().decode(output.stderr),
    );
  }

  return output.stdout;
}

async function compile_gpufuck_suite(
  compiler: GpuFunctionalCompiler,
  sources: readonly BenchmarkSource[],
): Promise<GpufuckMeasurement> {
  const total_start = performance.now();
  const duck_lower_and_encode_start = performance.now();
  const encoded_modules = sources.map((source) =>
    encode_gpufuck_module(source.text)
  );
  const duck_lower_and_encode_ms = performance.now() -
    duck_lower_and_encode_start;
  const compile_start = performance.now();
  const results = await compiler.compileBatch(encoded_modules);
  const gpu_compile_ms = performance.now() - compile_start;
  const compiled_modules: GpuFunctionalModule[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];

    if (result === undefined) {
      for (const module of compiled_modules) {
        module.destroy();
      }

      throw new Error(
        "gpufuck benchmark omitted compilation result " + index.toString(),
      );
    }

    if (!result.ok) {
      for (const module of compiled_modules) {
        module.destroy();
      }

      const source = sources[index];
      let path = "source " + index.toString();

      if (source !== undefined) {
        path = source.path;
      }

      throw new Error(
        "gpufuck benchmark failed " + path + " with " +
          result.diagnostics[0].code + ": " +
          result.diagnostics[0].message,
      );
    }

    compiled_modules.push(result.module);
  }

  const emit_start = performance.now();
  let modules: readonly Uint8Array<ArrayBuffer>[];

  try {
    modules = await Promise.all(
      compiled_modules.map(compileFunctionalModuleToWasm),
    );
  } finally {
    for (const module of compiled_modules) {
      module.destroy();
    }
  }

  const wasm_emit_ms = performance.now() - emit_start;
  let wasm_bytes = 0;

  for (const module of modules) {
    wasm_bytes += module.byteLength;
  }

  return {
    duck_lower_and_encode_ms,
    gpu_compile_ms,
    wasm_emit_ms,
    total_ms: performance.now() - total_start,
    wasm_bytes,
    modules,
  };
}

async function verify_modules(
  modules: readonly Uint8Array<ArrayBuffer>[],
  sources: readonly BenchmarkSource[],
): Promise<void> {
  if (modules.length !== sources.length) {
    throw new Error(
      "gpufuck benchmark emitted " + modules.length.toString() +
        " modules for " + sources.length.toString() + " sources",
    );
  }

  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index];
    const source = sources[index];

    if (module === undefined || source === undefined) {
      throw new Error(
        "gpufuck benchmark omitted verification input " + index.toString(),
      );
    }

    const instantiated = await WebAssembly.instantiate(module);
    const main = instantiated.instance.exports.main;

    if (typeof main !== "function") {
      throw new Error("gpufuck output for " + source.path + " omitted main");
    }

    const actual = main();

    if (actual !== source.expected) {
      throw new Error(
        "gpufuck output for " + source.path + " returned " +
          String(actual) + "; expected " + source.expected.toString(),
      );
    }
  }
}

function median(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new Error("cannot compute median of an empty benchmark sample");
  }

  const sorted = samples.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];

  if (value === undefined) {
    throw new Error(
      "benchmark median omitted sorted sample " + middle.toString(),
    );
  }

  if (sorted.length % 2 === 1) {
    return value;
  }

  const previous = sorted[middle - 1];

  if (previous === undefined) {
    throw new Error("benchmark median omitted lower middle sample");
  }

  return (previous + value) / 2;
}
