import { expect } from "../../expect.ts";
import type { CoreTypeField } from "../ast.ts";
import { runtime_union_payload } from "../runtime_union_payload.ts";
import type { TypeStaticCtx } from "../type_static.ts";
import type { RuntimeUnionMatchInfo, RuntimeUnionTarget } from "./types.ts";

export function runtime_union_match_info<ctx extends TypeStaticCtx>(
  case_name: string,
  target: RuntimeUnionTarget,
  ctx: ctx,
): RuntimeUnionMatchInfo {
  let declared: CoreTypeField | undefined;
  let tag_value = 0;

  for (let index = 0; index < target.type_value.cases.length; index += 1) {
    const union_case = target.type_value.cases[index];
    expect(union_case, "Missing core union case " + index.toString());

    if (union_case.name === case_name) {
      declared = union_case;
      tag_value = index;
    }
  }

  expect(declared, "Missing union case: " + case_name);
  const payload = runtime_union_payload(declared.type_name, ctx);

  return {
    case_name,
    tag_value,
    payload,
  };
}
