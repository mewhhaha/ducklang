import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { text_content_bytes } from "./text.ts";
import {
  lower_runtime_text_byte_index as lower_runtime_text_byte_index_with_hooks,
  lower_static_text_byte_index as lower_static_text_byte_index_with_hooks,
  lower_text_len as lower_text_len_with_hooks,
} from "./text_lower.ts";
import type { TextLowerHooks } from "./text_lower_types.ts";
import {
  check_text_concat_operand_visibility
    as check_text_concat_operand_visibility_with_hooks,
  visible_text_value as visible_text_value_with_hooks,
} from "./text_visible.ts";

export type FrontendTextLower = {
  check_text_concat_operand_visibility: (expr: FrontExpr, env: Env) => void;
  lower_runtime_text_byte_index: (
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ) => IcNode | undefined;
  lower_static_text_byte_index: (
    object: FrontExpr,
    index: number,
    env: Env,
  ) => IcNode | undefined;
  lower_text_len: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => IcNode | undefined;
  resolve_text_bytes: (expr: FrontExpr, env: Env) => number[] | undefined;
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};

export function create_frontend_text_lower(
  hooks: TextLowerHooks,
): FrontendTextLower {
  function lower_text_len(
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ): IcNode | undefined {
    return lower_text_len_with_hooks(expr, env, seen, hooks);
  }

  function lower_static_text_byte_index(
    object: FrontExpr,
    index: number,
    env: Env,
  ): IcNode | undefined {
    return lower_static_text_byte_index_with_hooks(
      object,
      index,
      env,
      hooks,
    );
  }

  function lower_runtime_text_byte_index(
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ): IcNode | undefined {
    return lower_runtime_text_byte_index_with_hooks(
      object,
      index,
      env,
      hooks,
    );
  }

  function visible_text_value(
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ): FrontExpr | undefined {
    return visible_text_value_with_hooks(expr, env, seen, hooks);
  }

  function resolve_text_bytes(
    expr: FrontExpr,
    env: Env,
  ): number[] | undefined {
    const text = visible_text_value(expr, env, new Set());

    if (!text) {
      return undefined;
    }

    if (text.tag !== "text") {
      return undefined;
    }

    return text_content_bytes(text.value);
  }

  function check_text_concat_operand_visibility(
    expr: FrontExpr,
    env: Env,
  ): void {
    check_text_concat_operand_visibility_with_hooks(expr, env, hooks);
  }

  return {
    check_text_concat_operand_visibility,
    lower_runtime_text_byte_index,
    lower_static_text_byte_index,
    lower_text_len,
    resolve_text_bytes,
    visible_text_value,
  };
}
