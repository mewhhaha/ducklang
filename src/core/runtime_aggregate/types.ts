import type { ValType } from "../../op.ts";
import type { Wat } from "../../wat.ts";
import type { CoreExpr } from "../ast.ts";
import type { CoreScratchHeap } from "../scratch.ts";
import type { TypeStaticCtx } from "../type_static.ts";

export type RuntimeAggregateTempCtx = {
  locals: Map<string, ValType>;
  next_temp: number;
};

export type RuntimeAggregateEmitCtx = RuntimeAggregateTempCtx & {
  allocation_permits:
    import("../allocation_emission.ts").CoreAllocationPermitState;
  next_loop: number;
  heap: {
    needed: boolean;
  };
  scratch: CoreScratchHeap;
  scratch_return_resets: string[];
};

export type RuntimeAggregateHooks<ctx extends TypeStaticCtx> = {
  core_expr_is_text: (expr: CoreExpr, ctx: ctx) => boolean;
  emit_expr: (expr: CoreExpr, ctx: ctx) => Wat;
  expr_type: (expr: CoreExpr, ctx: ctx) => ValType;
  runtime_aggregate_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  runtime_union_type_expr: (
    expr: CoreExpr,
    ctx: ctx,
  ) => CoreExpr | undefined;
  same_runtime_aggregate_type_expr: (
    left: CoreExpr | undefined,
    right: CoreExpr | undefined,
    ctx: ctx,
  ) => boolean;
  same_runtime_union_type_expr: (
    left: CoreExpr,
    right: CoreExpr,
    ctx: ctx,
  ) => boolean;
  static_struct_value: (
    expr: CoreExpr,
    ctx: ctx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
};

export type RuntimeAggregateFreezeCopySupportHooks<
  ctx extends TypeStaticCtx,
> = {
  runtime_union_freeze_copy_supported: (
    type_expr: CoreExpr,
    ctx: ctx,
  ) => boolean;
};

export type RuntimeAggregateFreezeCopyLocalHooks<
  ctx extends TypeStaticCtx,
> =
  & RuntimeAggregateFreezeCopySupportHooks<ctx>
  & {
    declare_runtime_union_freeze_copy_locals: (
      type_expr: CoreExpr,
      ctx: ctx,
    ) => void;
  };

export type RuntimeAggregateFreezeCopyHooks<ctx extends TypeStaticCtx> =
  & RuntimeAggregateHooks<ctx>
  & {
    emit_runtime_union_freeze_copy: (
      subject: CoreExpr,
      source: CoreExpr,
      type_expr: CoreExpr,
      ctx: ctx,
      hooks: RuntimeAggregateFreezeCopyHooks<ctx>,
    ) => Wat;
  };

export type RuntimeAggregatePlan = {
  local: string;
};
