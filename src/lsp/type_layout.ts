import type { BindingEntity } from "../frontend/binding_index.ts";
import type { FrontExpr, Source, TypeDeclaration } from "../frontend/ast.ts";
import { layout_type } from "../frontend/layout.ts";

export type TypeLayoutInfo = ReturnType<typeof layout_type>;

export function type_entity_layout(
  source: Source,
  entity: BindingEntity,
): TypeLayoutInfo | undefined {
  if (entity.kind !== "type" || source.declarations === undefined) {
    return undefined;
  }

  const declaration = source.declarations.find((candidate) =>
    candidate.tag === "type" && candidate.name === entity.name
  );

  if (declaration === undefined || declaration.tag !== "type") {
    return undefined;
  }

  const value = type_declaration_value(declaration);

  if (value === undefined) {
    return undefined;
  }

  try {
    return layout_type(value);
  } catch (error) {
    if (error instanceof Error) {
      return undefined;
    }

    throw error;
  }
}

export function entity_type_declaration(
  source: Source,
  entity: BindingEntity,
): TypeDeclaration | undefined {
  if (source.declarations === undefined) {
    return undefined;
  }

  const declaration = source.declarations.find((candidate) =>
    candidate.tag === "type" && candidate.name === entity.name
  );

  if (declaration === undefined || declaration.tag !== "type") {
    return undefined;
  }

  return declaration;
}

function type_declaration_value(
  declaration: TypeDeclaration,
): FrontExpr | undefined {
  if (declaration.body.tag === "product") {
    return { tag: "struct_type", fields: declaration.body.fields };
  }

  if (declaration.body.tag === "sum") {
    return { tag: "union_type", cases: declaration.body.cases };
  }

  return undefined;
}
