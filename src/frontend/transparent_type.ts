import { expect } from "../expect.ts";
import type { TypeExpr } from "../type_syntax.ts";
import { substitute_type_expr } from "./baba_declaration_lower.ts";
import { format_type_expr } from "./type_expr.ts";

export type TransparentTypeDefinition = {
  parameters: readonly string[];
  body: TypeExpr;
};

export function normalize_transparent_type_expression(
  type: TypeExpr,
  definitions: ReadonlyMap<string, TransparentTypeDefinition>,
  resolving = new Set<string>(),
): TypeExpr {
  const application = transparent_type_application(type);
  if (application !== undefined && !resolving.has(application.name)) {
    const definition = definitions.get(application.name);
    if (
      definition !== undefined &&
      definition.parameters.length === application.arguments.length
    ) {
      const substitutions = new Map<string, TypeExpr>();
      for (let index = 0; index < definition.parameters.length; index += 1) {
        const parameter = definition.parameters[index];
        const argument = application.arguments[index];
        expect(
          parameter !== undefined && argument !== undefined,
          `Transparent type ${application.name} lost argument ${index}.`,
        );
        substitutions.set(
          parameter,
          normalize_transparent_type_expression(
            argument,
            definitions,
            resolving,
          ),
        );
      }
      const nested = new Set(resolving);
      nested.add(application.name);
      return normalize_transparent_type_expression(
        substitute_type_expr(definition.body, substitutions),
        definitions,
        nested,
      );
    }
  }
  if (type.tag === "frozen" || type.tag === "borrow") {
    return {
      tag: type.tag,
      value: normalize_transparent_type_expression(
        type.value,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "union" || type.tag === "intersection") {
    const pending = [type.left, type.right];
    const members: TypeExpr[] = [];
    while (pending.length > 0) {
      const member = pending.pop();
      expect(member !== undefined, "Type-set member disappeared.");
      const normalized_member = normalize_transparent_type_expression(
        member,
        definitions,
        resolving,
      );
      if (normalized_member.tag === type.tag) {
        pending.push(normalized_member.left, normalized_member.right);
        continue;
      }
      members.push(normalized_member);
    }
    members.sort((left, right) => {
      const left_name = format_type_expr(left);
      const right_name = format_type_expr(right);
      if (left_name < right_name) return -1;
      if (left_name > right_name) return 1;
      return 0;
    });
    const distinct_members = members.filter((member, index) => {
      if (index === 0) return true;
      const previous = members[index - 1];
      expect(previous !== undefined, "Sorted type-set member disappeared.");
      return format_type_expr(previous) !== format_type_expr(member);
    });
    const first_member = distinct_members[0];
    expect(first_member !== undefined, "Type set cannot lose every member.");
    let normalized = first_member;
    for (let index = 1; index < distinct_members.length; index += 1) {
      const member = distinct_members[index];
      expect(member !== undefined, "Distinct type-set member disappeared.");
      normalized = {
        tag: type.tag,
        left: normalized,
        right: member,
      };
    }
    return normalized;
  }
  if (type.tag === "difference") {
    return {
      tag: "difference",
      left: normalize_transparent_type_expression(
        type.left,
        definitions,
        resolving,
      ),
      right: normalize_transparent_type_expression(
        type.right,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "apply") {
    return {
      tag: "apply",
      func: normalize_transparent_type_expression(
        type.func,
        definitions,
        resolving,
      ),
      arg: normalize_transparent_type_expression(
        type.arg,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "tuple") {
    return {
      tag: "tuple",
      items: type.items.map((value) =>
        normalize_transparent_type_expression(value, definitions, resolving)
      ),
    };
  }
  if (type.tag === "product") {
    return {
      tag: "product",
      entries: type.entries.map((entry) => ({
        label: entry.label,
        type_expr: normalize_transparent_type_expression(
          entry.type_expr,
          definitions,
          resolving,
        ),
      })),
      value_pack: type.value_pack,
      repeat: type.repeat,
    };
  }
  if (type.tag === "array") {
    return {
      tag: "array",
      element: normalize_transparent_type_expression(
        type.element,
        definitions,
        resolving,
      ),
      length: type.length,
    };
  }
  if (type.tag === "arrow") {
    return {
      tag: "arrow",
      param: normalize_transparent_type_expression(
        type.param,
        definitions,
        resolving,
      ),
      effects: type.effects,
      result: normalize_transparent_type_expression(
        type.result,
        definitions,
        resolving,
      ),
    };
  }
  if (type.tag === "forall") {
    return {
      tag: "forall",
      params: [...type.params],
      body: normalize_transparent_type_expression(
        type.body,
        definitions,
        resolving,
      ),
    };
  }
  return type;
}

function transparent_type_application(
  type: TypeExpr,
): { name: string; arguments: readonly TypeExpr[] } | undefined {
  const type_arguments: TypeExpr[] = [];
  let function_type = type;
  while (function_type.tag === "apply") {
    type_arguments.unshift(function_type.arg);
    function_type = function_type.func;
  }
  if (function_type.tag !== "name") return undefined;
  return { name: function_type.name, arguments: type_arguments };
}
