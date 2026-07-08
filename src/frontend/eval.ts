import type { Env, FrontExpr, Stmt } from "./ast.ts";
import { eval_front_block_impl, type FrontBlockEvalApi } from "./eval/block.ts";
import {
  eval_simple_front_block_impl,
  type FrontSimpleBlockEvalApi,
} from "./eval/simple.ts";
import type { FrontEvalHooks } from "./eval/types.ts";
import { eval_front_value_impl, type FrontValueEvalApi } from "./eval/value.ts";

export type { FrontEvalHooks } from "./eval/types.ts";

export function eval_front_value(
  expr: FrontExpr,
  env: Env,
  hooks: FrontEvalHooks,
): FrontExpr {
  return eval_front_value_impl(expr, env, hooks, eval_value_api);
}

export function eval_front_block(
  stmts: Stmt[],
  env: Env,
  hooks: FrontEvalHooks,
): FrontExpr {
  return eval_front_block_impl(stmts, env, hooks, eval_block_api);
}

export function eval_simple_front_block(
  expr: Extract<FrontExpr, { tag: "block" }>,
  env: Env,
  hooks: FrontEvalHooks,
): FrontExpr | undefined {
  return eval_simple_front_block_impl(expr, env, hooks, eval_simple_block_api);
}

const eval_value_api = {
  eval_front_block,
  eval_front_value,
} satisfies FrontValueEvalApi;

const eval_block_api = {
  eval_front_block,
  eval_front_value,
} satisfies FrontBlockEvalApi;

const eval_simple_block_api = {
  eval_front_block,
} satisfies FrontSimpleBlockEvalApi;
