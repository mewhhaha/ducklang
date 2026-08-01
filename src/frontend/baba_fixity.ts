import { Applicative } from "@mewhhaha/typeclasses";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import type { FixityDeclaration } from "./ast.ts";
import {
  type BabaCstNode,
  type BabaParseResult,
  parse_duck_source,
} from "./baba_parser.ts";
import { type Checked, fail, ok } from "./checked.ts";
import { mark_source_span } from "./syntax.ts";
import prelude_text from "./prelude.duck" with { type: "text" };
import functional_prelude_text from "./prelude_functional.duck" with {
  type: "text",
};
import runtime_prelude_text from "./prelude_runtime.duck" with { type: "text" };

export type BabaInfixFixity = {
  kind: "infix";
  associativity: "left" | "right" | "none";
  precedence: number;
  operator: string;
  target: string;
  builtin: boolean;
  valid_target: boolean;
  source_defined: boolean;
};

export type BabaPrefixFixity = {
  kind: "prefix";
  precedence: number;
  operator: string;
  target: string;
  builtin: boolean;
  valid_target: boolean;
  source_defined: boolean;
};

type BabaFixity = BabaInfixFixity | BabaPrefixFixity;

type RegisteredFixity = {
  fixity: BabaFixity;
  declaration_node: BabaCstNode | undefined;
};

type BabaFixityTable = {
  infix: Map<string, RegisteredFixity>;
  prefix: Map<string, RegisteredFixity>;
};

const infix_fixities = new WeakMap<BabaCstNode, BabaInfixFixity>();
const prefix_fixities = new WeakMap<BabaCstNode, BabaPrefixFixity>();
const lowered_declarations = new WeakMap<
  BabaCstNode,
  Checked<FixityDeclaration>
>();

const prelude_fixities = [
  prelude_text,
  runtime_prelude_text,
  functional_prelude_text,
].flatMap((source) => {
  const parsed = parse_duck_source(source);
  expect(
    parsed.diagnostics.length === 0,
    "Canonical prelude fixities must parse through Baba.",
  );
  const root = parsed.cst.root;
  expect(root !== undefined, "Canonical prelude has no Baba root.");
  return root.children.filter((node) =>
    node.kind === "fixity_declaration_statement"
  ).map((node) => {
    const fixity = read_fixity(node, source, false);
    expect(fixity !== undefined, "Canonical prelude fixity is malformed.");
    return fixity;
  });
});

export function index_baba_fixities(
  parsed: BabaParseResult,
): void {
  const table = create_fixity_table();
  const root = parsed.cst.root;
  if (root === undefined) return;
  const source = parsed.cst.text;

  for (
    const node of root.children.filter((child) =>
      child.kind === "fixity_declaration_statement"
    )
  ) {
    const fixity = read_fixity(node, source, true);
    if (fixity === undefined) {
      lowered_declarations.set(
        node,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Malformed fixity declaration.",
            { start: node.start, end: node.end },
          ),
        ),
      );
      continue;
    }
    const declaration = fixity_declaration(fixity);
    mark_source_span(declaration, { start: node.start, end: node.end });
    let declaration_check: Checked<FixityDeclaration> = ok(declaration);
    const precedence_node = node.children.find((child) =>
      child.kind === "number"
    );
    expect(
      precedence_node !== undefined,
      "Complete Baba fixity has no precedence node.",
    );
    const precedence_text = source.slice(
      precedence_node.start,
      precedence_node.end,
    );
    if (!/^\d+$/.test(precedence_text)) {
      declaration_check = Applicative.lift(
        (value: FixityDeclaration, _precedence: null) => value,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Fixity precedence must be an integer from 0 to 100",
            {
              start: precedence_node.start,
              end: precedence_node.end,
            },
          ),
        ),
      );
    } else if (
      !Number.isInteger(fixity.precedence) ||
      fixity.precedence < 0 || fixity.precedence > 100
    ) {
      declaration_check = Applicative.lift(
        (value: FixityDeclaration, _precedence: null) => value,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Fixity precedence must be an integer from 0 to 100, got " +
              fixity.precedence.toString(),
            {
              start: precedence_node.start,
              end: precedence_node.end,
            },
          ),
        ),
      );
    }
    if (!fixity.valid_target) {
      const target_node = node.children.find((child) =>
        child.kind === "fixity_target"
      );
      expect(
        target_node !== undefined,
        "Complete Baba fixity has no target node.",
      );
      declaration_check = Applicative.lift(
        (value: FixityDeclaration, _target: null) => value,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Invalid " + fixity.kind + " compiler syntax target: " +
              fixity.target,
            { start: target_node.start, end: target_node.end },
          ),
        ),
      );
    }

    let registrations: Map<string, RegisteredFixity>;
    if (fixity.kind === "prefix") {
      registrations = table.prefix;
    } else {
      registrations = table.infix;
    }
    const existing = registrations.get(fixity.operator);
    let registers = true;
    if (
      existing?.declaration_node !== undefined &&
      !existing.fixity.builtin &&
      same_fixity(existing.fixity, fixity)
    ) {
      registers = false;
    }
    if (
      existing !== undefined &&
      !existing.fixity.builtin &&
      !same_fixity(existing.fixity, fixity)
    ) {
      const operator_node = node.children.find((child) =>
        child.kind === "operator_symbol"
      );
      expect(
        operator_node !== undefined,
        "Baba fixity operator node disappeared.",
      );
      const related = [];
      if (existing.declaration_node !== undefined) {
        const previous_operator = existing.declaration_node.children.find(
          (child) => child.kind === "operator_symbol",
        );
        expect(
          previous_operator !== undefined,
          "Previous Baba fixity operator node disappeared.",
        );
        related.push({
          message: "First operator declaration is here.",
          span: {
            start: previous_operator.start,
            end: previous_operator.end,
          },
        });
      }
      declaration_check = Applicative.lift(
        (value: FixityDeclaration, _duplicate: null) => value,
        declaration_check,
        fail(
          compiler_diagnostic(
            diagnostic_codes.syntax_error,
            "Duplicate " + fixity.kind + " operator declaration: " +
              fixity.operator,
            { start: operator_node.start, end: operator_node.end },
            related,
          ),
        ),
      );
      registers = false;
    }
    if (registers) {
      registrations.set(fixity.operator, {
        fixity,
        declaration_node: node,
      });
    }
    lowered_declarations.set(node, declaration_check);
  }

  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    expect(node !== undefined, "Baba fixity indexing work disappeared.");
    if (node.children.length === 0) {
      const operator = source.slice(node.start, node.end);
      const infix = table.infix.get(operator)?.fixity;
      if (infix?.kind === "infix") infix_fixities.set(node, infix);
      const prefix = table.prefix.get(operator)?.fixity;
      if (prefix?.kind === "prefix") prefix_fixities.set(node, prefix);
    }
    pending.push(...node.children);
  }
}

export function baba_infix_fixity(
  node: BabaCstNode,
): BabaInfixFixity | undefined {
  return infix_fixities.get(node);
}

export function baba_prefix_fixity(
  node: BabaCstNode,
): BabaPrefixFixity | undefined {
  return prefix_fixities.get(node);
}

export function lower_indexed_baba_fixity(
  node: BabaCstNode,
): Checked<FixityDeclaration> {
  const declaration = lowered_declarations.get(node);
  expect(
    declaration !== undefined,
    "Baba fixity declaration was not indexed before lowering.",
  );
  return declaration;
}

function create_fixity_table(): BabaFixityTable {
  const table: BabaFixityTable = {
    infix: new Map(),
    prefix: new Map(),
  };
  for (const fixity of prelude_fixities) {
    let registrations: Map<string, RegisteredFixity>;
    if (fixity.kind === "prefix") {
      registrations = table.prefix;
    } else {
      registrations = table.infix;
    }
    const existing = registrations.get(fixity.operator);
    if (
      existing !== undefined &&
      !existing.fixity.builtin &&
      !same_fixity(existing.fixity, fixity)
    ) {
      throw new Error(
        "Canonical preludes declare conflicting " + fixity.kind +
          " operator " + fixity.operator + ".",
      );
    }
    registrations.set(fixity.operator, {
      fixity,
      declaration_node: undefined,
    });
  }
  return table;
}

function read_fixity(
  node: BabaCstNode,
  source: string,
  source_defined: boolean,
): BabaFixity | undefined {
  const keyword_node = node.children.find((child) =>
    child.kind === '"infixl"' || child.kind === '"infixr"' ||
    child.kind === '"infix"' || child.kind === '"prefix"'
  );
  const precedence_node = node.children.find((child) =>
    child.kind === "number"
  );
  const operator_node = node.children.find((child) =>
    child.kind === "operator_symbol"
  );
  const target_node = node.children.find((child) =>
    child.kind === "fixity_target"
  );
  if (
    keyword_node === undefined || precedence_node === undefined ||
    operator_node === undefined || target_node === undefined
  ) {
    return undefined;
  }
  const keyword = source.slice(keyword_node.start, keyword_node.end);
  const precedence = Number(
    source.slice(precedence_node.start, precedence_node.end),
  );
  const operator = source.slice(operator_node.start, operator_node.end);
  const target_parts: string[] = [];
  collect_target_parts(target_node, source, target_parts);
  if (target_parts.length === 0) return undefined;
  const target = target_parts.join(".");
  const builtin = target.startsWith("@syntax.");
  if (keyword === "prefix") {
    return {
      kind: "prefix",
      precedence,
      operator,
      target,
      builtin,
      valid_target: valid_compiler_syntax_target("prefix", target),
      source_defined,
    };
  }
  let associativity: "left" | "right" | "none" = "none";
  if (keyword === "infixl") associativity = "left";
  if (keyword === "infixr") associativity = "right";
  return {
    kind: "infix",
    associativity,
    precedence,
    operator,
    target,
    builtin,
    valid_target: valid_compiler_syntax_target("infix", target),
    source_defined,
  };
}

function valid_compiler_syntax_target(
  kind: "infix" | "prefix",
  target: string,
): boolean {
  if (!target.startsWith("@syntax.")) return true;
  if (kind === "prefix") {
    return target === "@syntax.not" || target === "@syntax.negate";
  }
  return target === "@syntax.and" || target === "@syntax.or" ||
    target === "@syntax.eq" || target === "@syntax.ne" ||
    target === "@syntax.lt" || target === "@syntax.le" ||
    target === "@syntax.gt" || target === "@syntax.ge" ||
    target === "@syntax.add" || target === "@syntax.sub" ||
    target === "@syntax.mul" || target === "@syntax.div" ||
    target === "@syntax.rem";
}

function collect_target_parts(
  node: BabaCstNode,
  source: string,
  parts: string[],
): void {
  if (node.kind === "identifier" || node.kind === "intrinsic_identifier") {
    parts.push(source.slice(node.start, node.end));
    return;
  }
  for (const child of node.children) {
    collect_target_parts(child, source, parts);
  }
}

function fixity_declaration(fixity: BabaFixity): FixityDeclaration {
  let keyword: "infixl" | "infixr" | "infix" | "prefix" = "prefix";
  if (fixity.kind === "infix") {
    keyword = "infix";
    if (fixity.associativity === "left") keyword = "infixl";
    if (fixity.associativity === "right") keyword = "infixr";
  }
  return {
    tag: "fixity",
    fixity: keyword,
    precedence: fixity.precedence,
    operator: fixity.operator,
    target: fixity.target,
  };
}

function same_fixity(left: BabaFixity, right: BabaFixity): boolean {
  if (
    left.kind !== right.kind ||
    left.precedence !== right.precedence ||
    left.operator !== right.operator ||
    left.target !== right.target
  ) {
    return false;
  }
  if (left.kind === "prefix" && right.kind === "prefix") return true;
  if (left.kind === "infix" && right.kind === "infix") {
    return left.associativity === right.associativity;
  }
  return false;
}
