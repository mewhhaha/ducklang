import type { ValType } from "../../../op.ts";
import type { Ic } from "../../ast.ts";

export type FuncInfo = {
  name: string;
  params: string[];
  param_types: Array<ValType | undefined>;
  result: ValType | undefined;
  body: Ic;
};

export type RecursiveInferCtx = {
  funcs: Map<string, FuncInfo>;
  types: Map<string, ValType>;
  params: string[];
  bound: Set<string>;
  changed: boolean;
};

export type EmitRecursiveCtx = {
  funcs: Map<string, FuncInfo>;
  types: Map<string, ValType>;
  aliases: Map<string, string>;
  locals: Map<string, ValType>;
};

export type RecursiveOpenTerm = {
  func: FuncInfo;
  funcs: Map<string, FuncInfo>;
  types: Map<string, ValType>;
  params: string[];
  main_result: ValType;
  func_result: ValType;
};
