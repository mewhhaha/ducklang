import type { DataSegment } from "../../mod.ts";
import type { CoreExpr, CoreStmt } from "../ast.ts";
import type { StaticTextCtx, StaticTextHooks } from "../text_static.ts";

export type TextLayout = {
  offsets: Map<string, number>;
  data: DataSegment[];
  heap_start: number;
};

export type CoreTextLayoutHooks = {
  core_binding_value: (
    stmt: Extract<CoreStmt, { tag: "bind" }>,
    ctx: StaticTextCtx,
  ) => CoreExpr;
  core_type_const_value: (
    stmt: Extract<CoreStmt, { tag: "bind" }>,
    value: CoreExpr,
    ctx: StaticTextCtx,
  ) => CoreExpr | undefined;
  dynamic_union_if: NonNullable<StaticTextHooks["dynamic_union_if"]>;
  expr_type: StaticTextHooks["expr_type"];
  static_collection_fields: StaticTextHooks["static_collection_fields"];
  static_core_call_value: (
    expr: CoreExpr,
    ctx: StaticTextCtx,
  ) => CoreExpr | undefined;
  static_struct_value: (
    expr: CoreExpr,
    ctx: StaticTextCtx,
  ) => Extract<CoreExpr, { tag: "struct_value" }> | undefined;
  static_union_case: NonNullable<StaticTextHooks["static_union_case"]>;
};
