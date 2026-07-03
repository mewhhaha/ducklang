import type { CoreExpr } from "../../ast.ts";
import {
  bind_core_assignment_struct_type
    as bind_core_assignment_struct_type_with_hooks,
  bind_core_assignment_union_type as bind_core_assignment_union_type_with_hooks,
  bind_core_fn_type as bind_core_fn_type_with_hooks,
  bind_core_struct_type as bind_core_struct_type_with_hooks,
  bind_core_union_type as bind_core_union_type_with_hooks,
  clear_core_local_facts as clear_core_local_facts_without_hooks,
  clear_optional_core_union_local
    as clear_optional_core_union_local_without_hooks,
  core_annotation_struct_type_expr
    as core_annotation_struct_type_expr_with_hooks,
  core_annotation_union_type_expr as core_annotation_union_type_expr_with_hooks,
} from "../../local_facts.ts";
import type { StaticCtx } from "../../local_collect.ts";
import { create_core_backend_local_fact_hooks } from "./local_facts/hooks.ts";
import type {
  CoreBackendLocalFacts,
  CoreBackendLocalFactsApi,
} from "./local_facts/types.ts";

export type {
  CoreBackendLocalFacts,
  CoreBackendLocalFactsApi,
} from "./local_facts/types.ts";

export function create_core_backend_local_facts(
  api: CoreBackendLocalFactsApi,
): CoreBackendLocalFacts {
  const local_fact_hooks = create_core_backend_local_fact_hooks(api);

  function bind_core_fn_type(
    name: string,
    value: CoreExpr,
    ctx: StaticCtx,
  ): void {
    bind_core_fn_type_with_hooks(name, value, ctx, local_fact_hooks);
  }

  function bind_core_union_type(
    name: string,
    value: CoreExpr,
    annotation: string | undefined,
    ctx: StaticCtx,
  ): void {
    bind_core_union_type_with_hooks(
      name,
      value,
      annotation,
      ctx,
      local_fact_hooks,
    );
  }

  function bind_core_struct_type(
    name: string,
    value: CoreExpr,
    annotation: string | undefined,
    ctx: StaticCtx,
  ): void {
    bind_core_struct_type_with_hooks(
      name,
      value,
      annotation,
      ctx,
      local_fact_hooks,
    );
  }

  function bind_core_assignment_union_type(
    name: string,
    value: CoreExpr,
    mode: "same" | "change",
    ctx: StaticCtx,
  ): void {
    bind_core_assignment_union_type_with_hooks(
      name,
      value,
      mode,
      ctx,
      local_fact_hooks,
    );
  }

  function bind_core_assignment_struct_type(
    name: string,
    value: CoreExpr,
    mode: "same" | "change",
    ctx: StaticCtx,
  ): void {
    bind_core_assignment_struct_type_with_hooks(
      name,
      value,
      mode,
      ctx,
      local_fact_hooks,
    );
  }

  function core_annotation_union_type_expr(
    annotation: string | undefined,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return core_annotation_union_type_expr_with_hooks(
      annotation,
      ctx,
      local_fact_hooks,
    );
  }

  function core_annotation_struct_type_expr(
    annotation: string | undefined,
    ctx: StaticCtx,
  ): CoreExpr | undefined {
    return core_annotation_struct_type_expr_with_hooks(
      annotation,
      ctx,
      local_fact_hooks,
    );
  }

  function clear_core_local_facts(name: string, ctx: StaticCtx): void {
    clear_core_local_facts_without_hooks(name, ctx);
  }

  function clear_optional_core_union_local(
    name: string | undefined,
    ctx: StaticCtx,
  ): void {
    clear_optional_core_union_local_without_hooks(name, ctx);
  }

  return {
    bind_core_assignment_struct_type,
    bind_core_assignment_union_type,
    bind_core_fn_type,
    bind_core_struct_type,
    bind_core_union_type,
    clear_core_local_facts,
    clear_optional_core_union_local,
    core_annotation_struct_type_expr,
    core_annotation_union_type_expr,
  };
}
