import type {
  Declaration,
  EffectOperation,
  Source,
  Stmt,
  TypeField,
} from "../frontend/ast.ts";
import { name_sites, type NameSite } from "../frontend/name_site.ts";
import { source_span, type SourceSyntax } from "../frontend/syntax.ts";
import { source_tokens } from "../frontend/tokenize.ts";
import {
  type LspRange,
  type PositionEncoding,
  PositionIndex,
} from "./position.ts";

export type LspDocumentSymbol = {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children: LspDocumentSymbol[];
};

const symbol_kind = {
  module: 2,
  class: 5,
  method: 6,
  field: 8,
  interface: 11,
  function: 12,
  variable: 13,
  constant: 14,
  enum_member: 22,
  type_parameter: 26,
} as const;

export function document_symbols(
  source: Source,
  syntax: SourceSyntax,
  encoding: PositionEncoding,
): LspDocumentSymbol[] {
  const positions = new PositionIndex(syntax.text, encoding);
  const symbols: LspDocumentSymbol[] = [];

  if (source.module !== undefined) {
    const tokens = source_tokens(syntax);
    const keyword = tokens.find((token) =>
      token.kind === "name" && token.text === "module"
    );

    if (keyword !== undefined) {
      const children: LspDocumentSymbol[] = [];

      for (const param of source.module.params) {
        const child = symbol_from_owner(
          param,
          "name",
          undefined,
          param.name,
          symbol_kind.variable,
          positions,
          [],
        );

        if (child !== undefined) {
          children.push(child);
        }
      }

      symbols.push({
        name: "module",
        kind: symbol_kind.module,
        range: range_from_span(positions, source_span(source.module)),
        selectionRange: range_from_span(positions, keyword.span),
        children,
      });
    }
  }

  if (source.declarations !== undefined) {
    for (const declaration of source.declarations) {
      const symbol = declaration_symbol(declaration, positions);

      if (symbol !== undefined) {
        symbols.push(symbol);
      }
    }
  }

  for (const statement of source.statements) {
    symbols.push(...statement_symbols(statement, syntax, positions));
  }

  symbols.sort((left, right) => {
    if (left.range.start.line !== right.range.start.line) {
      return left.range.start.line - right.range.start.line;
    }

    return left.range.start.character - right.range.start.character;
  });
  return symbols;
}

function declaration_symbol(
  declaration: Declaration,
  positions: PositionIndex,
): LspDocumentSymbol | undefined {
  const children: LspDocumentSymbol[] = [];
  let kind: number = symbol_kind.class;

  if (declaration.tag === "effect") {
    kind = symbol_kind.interface;

    for (const operation of declaration.operations) {
      const child = operation_symbol(operation, positions);

      if (child !== undefined) {
        children.push(child);
      }
    }
  } else if (declaration.tag === "record") {
    for (const field of declaration.fields) {
      const child = field_symbol(field, symbol_kind.field, positions);

      if (child !== undefined) {
        children.push(child);
      }
    }
  } else {
    for (let index = 0; index < declaration.params.length; index += 1) {
      const param = declaration.params[index];

      if (param === undefined) {
        throw new Error("Missing type parameter");
      }

      const child = symbol_from_owner(
        declaration,
        "params",
        index,
        param,
        symbol_kind.type_parameter,
        positions,
        [],
      );

      if (child !== undefined) {
        children.push(child);
      }
    }

    if (declaration.body.tag === "product") {
      for (const field of declaration.body.fields) {
        const child = field_symbol(field, symbol_kind.field, positions);

        if (child !== undefined) {
          children.push(child);
        }
      }
    } else if (declaration.body.tag === "sum") {
      for (const field of declaration.body.cases) {
        const child = field_symbol(field, symbol_kind.enum_member, positions);

        if (child !== undefined) {
          children.push(child);
        }
      }
    }
  }

  return symbol_from_owner(
    declaration,
    "name",
    undefined,
    declaration.name,
    kind,
    positions,
    children,
  );
}

function operation_symbol(
  operation: EffectOperation,
  positions: PositionIndex,
): LspDocumentSymbol | undefined {
  return symbol_from_owner(
    operation,
    "name",
    undefined,
    operation.name,
    symbol_kind.method,
    positions,
    [],
  );
}

function field_symbol(
  field: TypeField,
  kind: number,
  positions: PositionIndex,
): LspDocumentSymbol | undefined {
  return symbol_from_owner(
    field,
    "name",
    undefined,
    field.name,
    kind,
    positions,
    [],
  );
}

function statement_symbols(
  statement: Stmt,
  syntax: SourceSyntax,
  positions: PositionIndex,
): LspDocumentSymbol[] {
  if (statement.tag === "import") {
    const symbol = symbol_from_owner(
      statement,
      "name",
      undefined,
      statement.name,
      symbol_kind.module,
      positions,
      [],
    );

    if (symbol === undefined) {
      return [];
    }

    return [symbol];
  }

  if (statement.tag === "bind") {
    let kind: number = symbol_kind.variable;

    if (statement.kind === "const") {
      kind = symbol_kind.constant;
    }

    if (statement.value.tag === "lam" || statement.value.tag === "rec") {
      kind = symbol_kind.function;
    }

    const site = name_site(statement, "name", undefined, statement.name);

    if (site === undefined) {
      return [];
    }

    const prefix = syntax.text.slice(
      source_span(statement).start,
      site.span.start,
    );

    if (prefix.trimStart().startsWith("module ")) {
      kind = symbol_kind.module;
    }

    const symbol = symbol_from_owner(
      statement,
      "name",
      undefined,
      statement.name,
      kind,
      positions,
      [],
    );

    if (symbol === undefined) {
      throw new Error("Missing binding document symbol");
    }

    return [symbol];
  }

  if (statement.tag === "bind_pattern") {
    const symbols: LspDocumentSymbol[] = [];

    for (const item of statement.items) {
      let kind: number = symbol_kind.variable;

      if (statement.kind === "const") {
        kind = symbol_kind.constant;
      }

      const symbol = symbol_from_owner(
        item,
        "name",
        undefined,
        item.name,
        kind,
        positions,
        [],
      );

      if (symbol !== undefined) {
        symbols.push(symbol);
      }
    }

    return symbols;
  }

  return [];
}

function symbol_from_owner(
  owner: object,
  slot: string,
  index: number | undefined,
  name: string,
  kind: number,
  positions: PositionIndex,
  children: LspDocumentSymbol[],
): LspDocumentSymbol | undefined {
  const site = name_site(owner, slot, index, name);

  if (site === undefined) {
    return undefined;
  }

  return {
    name,
    kind,
    range: range_from_span(positions, source_span(owner)),
    selectionRange: range_from_span(positions, site.span),
    children,
  };
}

function name_site(
  owner: object,
  slot: string,
  index: number | undefined,
  name: string,
): NameSite | undefined {
  return name_sites(owner).find((site) =>
    site.slot === slot && site.index === index && site.name === name
  );
}

function range_from_span(
  positions: PositionIndex,
  span: { start: number; end: number },
): LspRange {
  return {
    start: positions.position_from_offset(span.start),
    end: positions.position_from_offset(span.end),
  };
}
