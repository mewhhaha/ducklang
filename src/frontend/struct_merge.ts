import type { FrontExpr, OperatorSyntax } from "./ast.ts";

export type StructMergeOperands = {
  base: FrontExpr;
  base_index: number;
  updates: Extract<FrontExpr, { tag: "shape" }>;
  updates_index: number;
};

export function struct_merge_operands(
  operator_syntax: OperatorSyntax | undefined,
  args: FrontExpr[],
): StructMergeOperands | undefined {
  if (operator_syntax === undefined || args.length !== 2) {
    return undefined;
  }

  let base_index: number;
  let updates_index: number;

  if (operator_syntax.target === "@merge") {
    base_index = 0;
    updates_index = 1;
  } else if (operator_syntax.target === "@merge_into") {
    base_index = 1;
    updates_index = 0;
  } else {
    return undefined;
  }

  const base = args[base_index];
  const updates = args[updates_index];

  if (base === undefined || updates?.tag !== "shape") {
    return undefined;
  }

  return { base, base_index, updates, updates_index };
}
