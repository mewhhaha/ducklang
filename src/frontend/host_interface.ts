import type { Source } from "./ast.ts";

export function source_with_host_interface(
  source: Source,
  host_interface: Source,
): Source {
  const host_declarations = host_interface.declarations || [];
  const source_declarations = source.declarations || [];
  const declarations = [...host_declarations, ...source_declarations];
  const names = new Set<string>();

  for (const declaration of declarations) {
    if (declaration.tag === "extend" || declaration.tag === "fixity") {
      continue;
    }

    if (names.has(declaration.name)) {
      throw new Error(
        "Duplicate host interface declaration: " + declaration.name,
      );
    }

    names.add(declaration.name);
  }

  return { ...source, declarations };
}
