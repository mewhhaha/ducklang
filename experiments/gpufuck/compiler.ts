import {
  compileFunctionalModuleToWasm,
  type EncodedFunctionalModule,
  type FunctionalCompileResult,
  type FunctionalComptimeExecutionOptions,
  type FunctionalComptimeExecutionResult,
  type FunctionalComptimeModuleArtifact,
  type FunctionalWasmAsyncInit,
  type FunctionalWasmAsyncRunOptions,
  type FunctionalWasmExecution,
  type FunctionalWasmInit,
  type FunctionalWasmInitBinding,
  type FunctionalWasmRunOptions,
  GpuFunctionalCompiler,
  GpuFunctionalComptimeExecutor,
  type GpuFunctionalModule,
  requestWebGpuDevice,
  runFunctionalWasmModule,
  runFunctionalWasmModuleAsync,
} from "../../../gpufuck/functional.ts";
import { Source } from "../../src/frontend.ts";
import type { Source as SourceNode } from "../../src/frontend/ast.ts";
import {
  lower_duck_source_to_gpufuck,
  type LoweredDuckGpufuckModule,
} from "./core_lowering.ts";

export type ExperimentalDuckRunOptions =
  & Omit<FunctionalWasmRunOptions, "init">
  & {
    init?: FunctionalWasmInit;
  };

export type ExperimentalDuckAsyncRunOptions =
  & Omit<
    FunctionalWasmAsyncRunOptions,
    "init"
  >
  & {
    init?: FunctionalWasmAsyncInit;
  };

export type ExperimentalDuckComptimeOptions =
  FunctionalComptimeExecutionOptions;

export type ExperimentalDuckComptimeResult = FunctionalComptimeExecutionResult;

export class ExperimentalDuckCompiler {
  readonly #device: GPUDevice;
  readonly #compiler: GpuFunctionalCompiler;
  #comptime: Promise<GpuFunctionalComptimeExecutor> | undefined;

  private constructor(device: GPUDevice, compiler: GpuFunctionalCompiler) {
    this.#device = device;
    this.#compiler = compiler;
  }

  static async create(): Promise<ExperimentalDuckCompiler> {
    const device = await requestWebGpuDevice();

    try {
      const compiler = await GpuFunctionalCompiler.create(device);
      return new ExperimentalDuckCompiler(device, compiler);
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  async compile(source: string): Promise<Uint8Array<ArrayBuffer>> {
    const modules = await this.compile_batch([source]);
    const module = modules[0];

    if (module === undefined) {
      throw new Error("gpufuck compiler omitted its only WebAssembly module");
    }

    return module;
  }

  async compile_batch(
    sources: readonly string[],
  ): Promise<readonly Uint8Array<ArrayBuffer>[]> {
    const lowered_modules = sources.map(lower_gpufuck_text);
    return await this.#compile_lowered_batch(lowered_modules);
  }

  async compile_file(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const modules = await this.#compile_lowered_batch([
      lower_gpufuck_file(path),
    ]);
    const module = modules[0];

    if (module === undefined) {
      throw new Error(
        "gpufuck compiler omitted WebAssembly module for " + path,
      );
    }

    return module;
  }

  async evaluate_comptime(
    source: string,
    options: ExperimentalDuckComptimeOptions = {},
  ): Promise<ExperimentalDuckComptimeResult> {
    return await this.#evaluate_comptime_module(
      lower_gpufuck_text(source),
      options,
    );
  }

  async evaluate_comptime_file(
    path: string,
    options: ExperimentalDuckComptimeOptions = {},
  ): Promise<ExperimentalDuckComptimeResult> {
    return await this.#evaluate_comptime_module(
      lower_gpufuck_file(path),
      options,
    );
  }

  async run(
    source: string,
    options: ExperimentalDuckRunOptions = {},
  ): Promise<FunctionalWasmExecution> {
    const lowered = lower_gpufuck_text(source);
    const module = await this.#compile_module(lowered.encoded);
    try {
      return await runFunctionalWasmModule(module, {
        ...options,
        init: merge_init(lowered.automatic_init, options.init),
      });
    } finally {
      module.destroy();
    }
  }

  async run_file(
    path: string,
    options: ExperimentalDuckRunOptions = {},
  ): Promise<FunctionalWasmExecution> {
    const lowered = lower_gpufuck_file(path);
    const module = await this.#compile_module(lowered.encoded);
    try {
      return await runFunctionalWasmModule(module, {
        ...options,
        init: merge_init(lowered.automatic_init, options.init),
      });
    } finally {
      module.destroy();
    }
  }

  async run_async(
    source: string,
    options: ExperimentalDuckAsyncRunOptions = {},
  ): Promise<FunctionalWasmExecution> {
    const lowered = lower_gpufuck_text(source);
    const module = await this.#compile_module(lowered.encoded);
    try {
      return await runFunctionalWasmModuleAsync(module, {
        ...options,
        init: merge_async_init(lowered.automatic_init, options.init),
      });
    } finally {
      module.destroy();
    }
  }

  async #compile_lowered_batch(
    lowered_modules: readonly LoweredDuckGpufuckModule[],
  ): Promise<readonly Uint8Array<ArrayBuffer>[]> {
    const results = await this.#compiler.compileBatch(
      lowered_modules.map((lowered) => lowered.encoded),
    );
    const compiled_modules = successful_modules(
      results,
      lowered_modules.length,
    );

    try {
      return await Promise.all(
        compiled_modules.map(compileFunctionalModuleToWasm),
      );
    } finally {
      for (const module of compiled_modules) {
        module.destroy();
      }
    }
  }

  async #compile_module(
    encoded: EncodedFunctionalModule,
  ): Promise<GpuFunctionalModule> {
    const result = await this.#compiler.compileModule(encoded);
    if (!result.ok) {
      throw compilation_error(result, 0);
    }
    return result.module;
  }

  async #evaluate_comptime_module(
    lowered: LoweredDuckGpufuckModule,
    options: ExperimentalDuckComptimeOptions,
  ): Promise<ExperimentalDuckComptimeResult> {
    const lowered_artifact = lowered.artifact;
    let comptime_artifact: FunctionalComptimeModuleArtifact = {
      name: lowered_artifact.name,
      definitions: lowered_artifact.definitions,
      typeDeclarations: lowered_artifact.typeDeclarations,
      imports: lowered_artifact.imports,
      exports: lowered_artifact.exports,
      sourceByteLength: lowered_artifact.sourceByteLength,
    };
    if (lowered_artifact.options.evaluationProfile !== undefined) {
      comptime_artifact = {
        ...comptime_artifact,
        evaluationProfile: lowered_artifact.options.evaluationProfile,
      };
    }
    if (this.#comptime === undefined) {
      this.#comptime = GpuFunctionalComptimeExecutor.create(this.#device);
    }
    const comptime = await this.#comptime;
    return await comptime.executeExports(
      [comptime_artifact],
      [{ module: comptime_artifact.name, exportName: "main" }],
      options,
    );
  }

  destroy(): void {
    this.#device.destroy();
  }
}

export function encode_gpufuck_module(
  source_text: string,
): EncodedFunctionalModule {
  return lower_gpufuck_text(source_text).encoded;
}

export function encode_gpufuck_file(path: string): EncodedFunctionalModule {
  return lower_gpufuck_file(path).encoded;
}

function lower_gpufuck_text(source_text: string): LoweredDuckGpufuckModule {
  const source = Source.parse(source_text);
  const source_byte_length = new TextEncoder().encode(source_text).byteLength;
  return lower_gpufuck_source(source, source_byte_length);
}

function lower_gpufuck_file(path: string): LoweredDuckGpufuckModule {
  const source = Source.load_fragment_file(path);
  const linked_source = Source.fmt(source);
  const source_byte_length = new TextEncoder().encode(linked_source).byteLength;
  return lower_gpufuck_source(source, source_byte_length);
}

function lower_gpufuck_source(
  source: SourceNode,
  source_byte_length: number,
): LoweredDuckGpufuckModule {
  return lower_duck_source_to_gpufuck(source, source_byte_length);
}

function successful_modules(
  results: readonly FunctionalCompileResult[],
  expected_module_count: number,
): GpuFunctionalModule[] {
  const modules: GpuFunctionalModule[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];

    if (result === undefined) {
      destroy_modules(modules);
      throw new Error(
        "gpufuck compiler omitted compilation result " + index.toString(),
      );
    }

    if (!result.ok) {
      destroy_modules(modules);
      throw compilation_error(result, index);
    }

    modules.push(result.module);
  }

  if (modules.length !== expected_module_count) {
    destroy_modules(modules);
    throw new Error(
      "gpufuck compiler returned " + modules.length.toString() +
        " results for " + expected_module_count.toString() + " sources",
    );
  }

  return modules;
}

function compilation_error(
  result: Extract<FunctionalCompileResult, { ok: false }>,
  index: number,
): Error {
  const diagnostic = result.diagnostics[0];
  if (diagnostic === undefined) {
    return new Error(
      "gpufuck compilation " + index.toString() +
        " failed without a diagnostic",
    );
  }
  return new Error(
    "gpufuck compilation " + index.toString() + " failed with " +
      diagnostic.code + " at bytes " + diagnostic.span.startByte.toString() +
      ".." + diagnostic.span.endByte.toString() + ": " + diagnostic.message,
  );
}

function destroy_modules(modules: readonly GpuFunctionalModule[]): void {
  for (const module of modules) {
    module.destroy();
  }
}

function merge_init(
  automatic: FunctionalWasmInit,
  supplied: FunctionalWasmInit | undefined,
): FunctionalWasmInit {
  const merged: Record<string, Record<string, FunctionalWasmInitBinding>> = {};
  for (const [capability, fields] of Object.entries(automatic)) {
    merged[capability] = { ...fields };
  }
  if (supplied !== undefined) {
    for (const [capability, fields] of Object.entries(supplied)) {
      const current = merged[capability];
      if (current === undefined) {
        merged[capability] = { ...fields };
      } else {
        Object.assign(current, fields);
      }
    }
  }
  return merged;
}

function merge_async_init(
  automatic: FunctionalWasmInit,
  supplied: FunctionalWasmAsyncInit | undefined,
): FunctionalWasmAsyncInit {
  const merged: Record<
    string,
    Record<string, FunctionalWasmAsyncInit[string][string]>
  > = {};
  for (const [capability, fields] of Object.entries(automatic)) {
    merged[capability] = { ...fields };
  }
  if (supplied !== undefined) {
    for (const [capability, fields] of Object.entries(supplied)) {
      const current = merged[capability];
      if (current === undefined) {
        merged[capability] = { ...fields };
      } else {
        Object.assign(current, fields);
      }
    }
  }
  return merged;
}
