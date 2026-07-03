import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr, CoreFnType } from "../ast.ts";

export type CoreCaptureStaticCtx = {
  locals: Map<string, ValType>;
  statics: Map<string, CoreExpr>;
  fn_types: Map<string, CoreFnType>;
  text_locals: Set<string>;
  struct_locals: Map<string, CoreExpr>;
  union_locals: Map<string, CoreExpr>;
  frozen_locals?: Set<string>;
};

export type CoreCaptureTempCtx = CoreCaptureStaticCtx & {
  next_temp: number;
};

export type CoreCaptureHooks<ctx extends CoreCaptureStaticCtx> = {
  static_struct_binding: (name: string, ctx: ctx) => CoreExpr | undefined;
};

export type CoreCaptureInfo = {
  names: string[];
  assigned_names: string[];
  assigned_static_names: string[];
  invalid_assignment: boolean;
};

export const unsupported_core_captured_assignment_message =
  "Core closure captured assignment only supports same-type scalar rebinding, runtime Text byte assignment, runtime aggregate scalar/Text index assignment, and static aggregate rebuilds";

export type CoreLamCapturePlan = {
  value: CoreExpr;
  setup: Wat;
};

export type CoreCaptureState<ctx extends CoreCaptureStaticCtx> = {
  ctx: ctx;
  locals: Map<string, ValType>;
  bound: Set<string>;
  names: string[];
  seen: Set<string>;
  assigned_names: string[];
  assigned_seen: Set<string>;
  assigned_static_names: string[];
  assigned_static_seen: Set<string>;
  static_seen: Set<string>;
  invalid_assignment: boolean;
  hooks: CoreCaptureHooks<ctx>;
};
