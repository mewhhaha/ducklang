import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, FrontType, TypeField } from "./ast.ts";
import {
  can_lower_dynamic_union_if_as_value
    as can_lower_dynamic_union_if_as_value_with_hooks,
  type DynamicBranchHooks,
  lower_dynamic_struct_if as lower_dynamic_struct_if_with_hooks,
  lower_dynamic_union_if as lower_dynamic_union_if_with_hooks,
  resolve_dynamic_if_let_struct_value
    as resolve_dynamic_if_let_struct_value_with_hooks,
  resolve_dynamic_struct_if_value as resolve_dynamic_struct_if_value_with_hooks,
  type ResolvedStructValue,
  type ResolvedUnionValue,
} from "./dynamic_branch.ts";

export type FrontendDynamicBranchApi = {
  infer_dynamic_if_let_cases: (
    expr: FrontExpr,
    env: Env,
  ) => TypeField[] | undefined;
  infer_dynamic_union_if_cases: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => TypeField[] | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_struct_value: (
    expr: Extract<FrontExpr, { tag: "struct_value" }>,
    env: Env,
  ) => IcNode;
  lower_union_case_value: (
    expr: Extract<FrontExpr, { tag: "union_case" }>,
    env: Env,
  ) => IcNode;
  resolve_annotation_type: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
  resolve_struct_type_value: (
    expr: FrontExpr,
    env: Env,
  ) => Extract<FrontExpr, { tag: "struct_type" }> | undefined;
  resolve_struct_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedStructValue | undefined;
  resolve_union_value: (
    expr: FrontExpr,
    env: Env,
  ) => ResolvedUnionValue | undefined;
};

export type FrontendDynamicBranch = {
  can_lower_dynamic_union_if_as_value: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => boolean;
  lower_dynamic_struct_if: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => IcNode | undefined;
  lower_dynamic_union_if: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => IcNode | undefined;
  resolve_dynamic_if_let_struct_value: (
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ) => ResolvedStructValue | undefined;
  resolve_dynamic_struct_if_value: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => ResolvedStructValue | undefined;
};

export function create_frontend_dynamic_branch(
  api: FrontendDynamicBranchApi,
): FrontendDynamicBranch {
  const dynamic_branch_hooks = {
    infer_dynamic_if_let_cases: api.infer_dynamic_if_let_cases,
    infer_dynamic_union_if_cases: api.infer_dynamic_union_if_cases,
    infer_expr: api.infer_expr,
    lower_expr: api.lower_expr,
    lower_struct_value: api.lower_struct_value,
    lower_union_case_value: api.lower_union_case_value,
    resolve_annotation_type: api.resolve_annotation_type,
    resolve_struct_type_value: api.resolve_struct_type_value,
    resolve_struct_value: api.resolve_struct_value,
    resolve_union_value: api.resolve_union_value,
  } satisfies DynamicBranchHooks;

  function lower_dynamic_struct_if(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): IcNode | undefined {
    return lower_dynamic_struct_if_with_hooks(expr, env, dynamic_branch_hooks);
  }

  function resolve_dynamic_struct_if_value(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): ResolvedStructValue | undefined {
    return resolve_dynamic_struct_if_value_with_hooks(
      expr,
      env,
      dynamic_branch_hooks,
    );
  }

  function resolve_dynamic_if_let_struct_value(
    expr: Extract<FrontExpr, { tag: "if_let" }>,
    env: Env,
  ): ResolvedStructValue | undefined {
    return resolve_dynamic_if_let_struct_value_with_hooks(
      expr,
      env,
      dynamic_branch_hooks,
    );
  }

  function lower_dynamic_union_if(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): IcNode | undefined {
    return lower_dynamic_union_if_with_hooks(expr, env, dynamic_branch_hooks);
  }

  function can_lower_dynamic_union_if_as_value(
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ): boolean {
    return can_lower_dynamic_union_if_as_value_with_hooks(
      expr,
      env,
      dynamic_branch_hooks,
    );
  }

  return {
    can_lower_dynamic_union_if_as_value,
    lower_dynamic_struct_if,
    lower_dynamic_union_if,
    resolve_dynamic_if_let_struct_value,
    resolve_dynamic_struct_if_value,
  };
}
