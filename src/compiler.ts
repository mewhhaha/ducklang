export {
  DuckCompiler,
  encode_duck_file,
  encode_duck_module,
} from "./backend/compiler.ts";
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
} from "./backend/compiler.ts";

export type {
  WasmAsyncInit as DuckAsyncInit,
  WasmHostValue as DuckHostValue,
  WasmInit as DuckInit,
} from "../../gpufuck/functional.ts";
