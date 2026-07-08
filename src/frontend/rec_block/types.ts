import type { Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr, FrontType } from "../ast.ts";
import type { StaticRecHooks } from "../rec_hooks.ts";
import type { StaticRecBlockLowerer, StaticRecResult } from "../rec_result.ts";

export type StaticRecExprLowerer = (
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  expected_type?: FrontType,
) => StaticRecResult | undefined;

export type StaticRecExpectedResultLowerer = (
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_block: StaticRecBlockLowerer,
  expected_type?: FrontType,
) => IcNode;
