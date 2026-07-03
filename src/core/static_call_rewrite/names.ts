import { expect } from "../../expect.ts";
import type { CoreExpr, CoreParam } from "../ast.ts";

export function scoped_static_core_call_names(
  names: string[],
  replacements: Map<string, CoreExpr>,
): string[] {
  return names.map((name) => {
    const replacement = replacement_var_name(replacements, name);

    if (replacement) {
      return replacement;
    }

    return name;
  });
}

export function replacement_var_name(
  replacements: Map<string, CoreExpr>,
  name: string,
): string | undefined {
  const replacement = replacements.get(name);

  if (!replacement) {
    return undefined;
  }

  expect(
    replacement.tag === "var",
    "Core static call replacement must be a variable: " + name,
  );
  return replacement.name;
}

export function shadow_core_call_params(
  replacements: Map<string, CoreExpr>,
  params: CoreParam[],
): Map<string, CoreExpr> {
  let local = replacements;

  for (const param of params) {
    local = shadow_core_call_name(local, param.name);
  }

  return local;
}

export function shadow_core_call_name(
  replacements: Map<string, CoreExpr>,
  name: string,
): Map<string, CoreExpr> {
  if (!replacements.has(name)) {
    return replacements;
  }

  const local = new Map(replacements);
  local.delete(name);
  return local;
}
