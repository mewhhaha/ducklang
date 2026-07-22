export {
  DuckCompiler,
  encode_duck_file,
  encode_duck_module,
} from "../experiments/gpufuck/compiler.ts";
export type {
  DuckAsyncRunFileOptions,
  DuckAsyncRunOptions,
  DuckComptimeOptions,
  DuckComptimeResult,
  DuckFileOptions,
  DuckProgram,
  DuckRunFileOptions,
  DuckRunOptions,
  DuckTestResult,
} from "../experiments/gpufuck/compiler.ts";

export type {
  FunctionalWasmAsyncInit as DuckAsyncInit,
  FunctionalWasmHostValue as DuckHostValue,
  FunctionalWasmInit as DuckInit,
} from "../../gpufuck/functional.ts";
