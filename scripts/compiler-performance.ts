import { success_examples } from "../examples/manifest.ts";
import { Source } from "../src/frontend.ts";

type RouteMeasurement = {
  examples: number;
  compile_ms: number;
  wat_bytes: number;
};

type CompilerMeasurement = {
  total_compile_ms: number;
  largest_compile_ms: number;
  largest_compile_path: string;
  largest_wat_bytes: number;
  largest_wat_path: string;
  routes: Record<"ic" | "core" | "managed", RouteMeasurement>;
};

const budget = {
  total_compile_ms: 5_000,
  largest_compile_ms: 1_000,
  largest_wat_bytes: 256 * 1024,
};

const routes: CompilerMeasurement["routes"] = {
  ic: { examples: 0, compile_ms: 0, wat_bytes: 0 },
  core: { examples: 0, compile_ms: 0, wat_bytes: 0 },
  managed: { examples: 0, compile_ms: 0, wat_bytes: 0 },
};
let largest_compile_ms = 0;
let largest_compile_path = "";
let largest_wat_bytes = 0;
let largest_wat_path = "";
const total_start = performance.now();

for (const example of success_examples) {
  const start = performance.now();
  let wat: string;

  if (example.route === "ic") {
    wat = Source.ic_wat(Source.load_fragment_file(example.path));
  } else if (example.route === "core") {
    wat = Source.wat(Source.load_fragment_file(example.path));
  } else {
    wat = Source.artifact_file(example.path).wat;
  }

  const compile_ms = performance.now() - start;
  const wat_bytes = new TextEncoder().encode(wat).byteLength;
  const route = routes[example.route];
  route.examples += 1;
  route.compile_ms += compile_ms;
  route.wat_bytes += wat_bytes;

  if (compile_ms > largest_compile_ms) {
    largest_compile_ms = compile_ms;
    largest_compile_path = example.path;
  }

  if (wat_bytes > largest_wat_bytes) {
    largest_wat_bytes = wat_bytes;
    largest_wat_path = example.path;
  }
}

const measurement: CompilerMeasurement = {
  total_compile_ms: performance.now() - total_start,
  largest_compile_ms,
  largest_compile_path,
  largest_wat_bytes,
  largest_wat_path,
  routes,
};

console.log(JSON.stringify({ budget, measurement }, undefined, 2));

if (measurement.total_compile_ms > budget.total_compile_ms) {
  throw new Error(
    "Compiler example suite exceeded total compile budget: " +
      measurement.total_compile_ms.toFixed(1) + "ms",
  );
}

if (measurement.largest_compile_ms > budget.largest_compile_ms) {
  throw new Error(
    "Compiler example exceeded compile budget: " +
      measurement.largest_compile_path + " took " +
      measurement.largest_compile_ms.toFixed(1) + "ms",
  );
}

if (measurement.largest_wat_bytes > budget.largest_wat_bytes) {
  throw new Error(
    "Compiler example exceeded WAT size budget: " +
      measurement.largest_wat_path + " emitted " +
      measurement.largest_wat_bytes.toString() + " bytes",
  );
}
