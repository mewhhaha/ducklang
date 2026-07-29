import { Language, type Node as TreeSitterNode, Parser } from "web-tree-sitter";
import { expect } from "../expect.ts";
import type { SyntaxDiagnostic } from "./syntax.ts";

export type BabaToken = {
  kind: string;
  text: string;
  start: number;
  end: number;
};

export type BabaSourceNodeId = string & {
  readonly __baba_source_node_id: unique symbol;
};

export type BabaCstNode = {
  id: BabaSourceNodeId;
  kind: string;
  start: number;
  end: number;
  children: BabaCstNode[];
};

export type BabaCst = {
  text: string;
  tree: string;
  root: BabaCstNode | undefined;
};

export type BabaRecoveryInterval = {
  diagnostic: SyntaxDiagnostic;
  skipped: {
    start: number;
    end: number;
  };
  source_node_id: BabaSourceNodeId;
};

export type BabaParseResult = {
  tokens: BabaToken[];
  diagnostics: SyntaxDiagnostic[];
  recovery_intervals: BabaRecoveryInterval[];
  cst: BabaCst;
};

const trusted_baba_parse_results = new WeakSet<object>();
await Parser.init();
const duck_language = await Language.load(
  await Deno.readFile(
    new URL("../../tree-sitter-duck/tree-sitter-duck.wasm", import.meta.url),
  ),
);
const duck_parser = new Parser();
duck_parser.setLanguage(duck_language);
const maximum_baba_cst_nesting = 512;

export function is_trusted_baba_parse_result(
  value: unknown,
): value is BabaParseResult {
  return value !== null && typeof value === "object" &&
    trusted_baba_parse_results.has(value);
}

/** Parse Duck source with the generated Baba Tree-sitter parser. */
export function parse_duck_source(text: string): BabaParseResult {
  duck_parser.reset();
  const tree = duck_parser.parse(text);
  expect(
    tree !== null,
    "Baba Tree-sitter parser did not return a syntax tree.",
  );

  try {
    const tokens = baba_tokens(tree.rootNode, text);
    const pending_nodes = [{ node: tree.rootNode, depth: 0 }];
    let excessive_node: TreeSitterNode | undefined;
    while (pending_nodes.length > 0) {
      const pending = pending_nodes.pop();
      expect(pending !== undefined, "Baba CST depth work disappeared.");
      if (pending.depth > maximum_baba_cst_nesting) {
        excessive_node = pending.node;
        break;
      }
      for (const child of pending.node.children) {
        pending_nodes.push({ node: child, depth: pending.depth + 1 });
      }
    }
    if (excessive_node !== undefined) {
      const error: BabaCstNode = {
        id: source_node_id(
          "ERROR",
          0,
          text.length,
          1,
        ),
        kind: "ERROR",
        start: 0,
        end: text.length,
        children: [],
      };
      const root: BabaCstNode = {
        id: source_node_id("source_file", 0, text.length, 0),
        kind: "source_file",
        start: 0,
        end: text.length,
        children: [error],
      };
      const diagnostic = {
        message: "Baba parser nesting exceeds the maximum of " +
          maximum_baba_cst_nesting.toString(),
        span: { start: error.start, end: error.end },
      };
      const parsed = {
        tokens,
        diagnostics: [diagnostic],
        recovery_intervals: [{
          diagnostic,
          skipped: { start: error.start, end: error.end },
          source_node_id: error.id,
        }],
        cst: { text, tree: render_cst(root), root },
      };
      deep_freeze(parsed);
      trusted_baba_parse_results.add(parsed);
      return parsed;
    }
    const ordinal = { value: 0 };
    const root = baba_cst_node(tree.rootNode, ordinal);
    const diagnostics: SyntaxDiagnostic[] = [];
    const recovery_intervals: BabaRecoveryInterval[] = [];
    let errors: BabaCstNode[] = [];
    const suppressed_error_intervals: { start: number; end: number }[] = [];
    collect_error_nodes(root, errors);
    collect_separated_immediate_type_arguments(root, text, errors);
    collect_contract_keyword_propositions(
      root,
      text,
      errors,
      suppressed_error_intervals,
    );
    errors = errors.filter((error) => {
      if (error.kind !== "ERROR" && error.kind !== "MISSING") return true;
      return !suppressed_error_intervals.some((interval) =>
        error.start >= interval.start && error.end <= interval.end
      );
    });
    errors.sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      return left.end - right.end;
    });
    let previous_error: BabaCstNode | undefined;
    for (const error of errors) {
      if (
        previous_error !== undefined &&
        previous_error.kind === error.kind &&
        previous_error.start === error.start &&
        previous_error.end === error.end
      ) {
        continue;
      }
      previous_error = error;
      let diagnostic: SyntaxDiagnostic;
      if (error.kind === "immediate_type_argument") {
        diagnostic = {
          message:
            "Parenthesized type application must start on the constructor's line",
          span: { start: error.start, end: error.start },
        };
      } else if (error.kind === "contract_keyword_proposition") {
        diagnostic = {
          message:
            "Contract clause requires a proposition before the next clause",
          span: { start: error.start, end: error.end },
        };
      } else if (error.kind === "contract_keyword_metric") {
        diagnostic = {
          message: "Contract clause requires a metric before the next clause",
          span: { start: error.start, end: error.end },
        };
      } else {
        diagnostic = {
          message: `Baba parser rejected ${error.kind}`,
          span: { start: error.start, end: error.end },
        };
      }
      diagnostics.push(diagnostic);
      if (
        error.kind === "contract_keyword_proposition" ||
        error.kind === "contract_keyword_metric"
      ) {
        continue;
      }
      recovery_intervals.push({
        diagnostic,
        skipped: { start: error.start, end: error.end },
        source_node_id: error.id,
      });
    }

    const parsed = {
      tokens,
      diagnostics,
      recovery_intervals,
      cst: { text, tree: render_cst(root), root },
    };
    deep_freeze(parsed);
    trusted_baba_parse_results.add(parsed);
    return parsed;
  } finally {
    tree.delete();
  }
}

function collect_contract_keyword_propositions(
  node: BabaCstNode,
  source: string,
  errors: BabaCstNode[],
  suppressed_error_intervals: { start: number; end: number }[],
): void {
  if (node.kind === "prefix_contract_clause") {
    const keyword = node.children.find((child) =>
      child.kind === "prefix_requires_keyword" ||
      child.kind === "prefix_ensures_keyword" ||
      child.kind === "prefix_decreases_keyword"
    );
    const proposition = node.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    const metric = node.children.find((child) =>
      child !== keyword &&
      child.kind !== "prefix_requires_keyword" &&
      child.kind !== "prefix_ensures_keyword" &&
      child.kind !== "prefix_decreases_keyword"
    );
    let metric_starts_statement = false;
    if (metric !== undefined) {
      const match = /^\s*([A-Za-z]+)/.exec(
        source.slice(metric.start, metric.end),
      );
      const first_word = match?.[1];
      metric_starts_statement = first_word === "let" ||
        first_word === "const" || first_word === "fact" ||
        first_word === "opaque" || first_word === "type" ||
        first_word === "requires" || first_word === "ensures" ||
        first_word === "decreases";
    }
    if (
      keyword?.kind === "prefix_decreases_keyword" &&
      (
        metric === undefined || metric.kind === "MISSING" ||
        metric.start === metric.end || metric_starts_statement
      )
    ) {
      errors.push({
        id: source_node_id(
          "contract_keyword_metric",
          keyword.end,
          keyword.end,
          0,
        ),
        kind: "contract_keyword_metric",
        start: keyword.end,
        end: keyword.end,
        children: [],
      });
      const statement_end = source.indexOf(";", keyword.end);
      let suppression_end = source.length;
      if (statement_end >= 0) {
        suppression_end = statement_end + 1;
      }
      suppressed_error_intervals.push({
        start: keyword.end,
        end: suppression_end,
      });
    }
    if (keyword !== undefined && proposition !== undefined) {
      const text = source.slice(proposition.start, proposition.end);
      if (
        text === "requires" || text === "ensures" || text === "decreases" ||
        text === "let" || text === "const" || text === "fact" ||
        text === "opaque" || text === "type"
      ) {
        errors.push({
          id: source_node_id(
            "contract_keyword_proposition",
            keyword.end,
            keyword.end,
            0,
          ),
          kind: "contract_keyword_proposition",
          start: keyword.end,
          end: keyword.end,
          children: [],
        });
      }
    }
  }
  for (const child of node.children) {
    collect_contract_keyword_propositions(
      child,
      source,
      errors,
      suppressed_error_intervals,
    );
  }
}

function baba_cst_node(
  node: TreeSitterNode,
  ordinal: { value: number },
): BabaCstNode {
  let kind: string;
  if (node.isMissing) {
    kind = "MISSING";
  } else if (node.isError) {
    kind = "ERROR";
  } else if (node.isNamed) {
    kind = node.type;
  } else {
    kind = JSON.stringify(node.type);
  }
  const node_ordinal = ordinal.value;
  ordinal.value += 1;
  return {
    id: source_node_id(kind, node.startIndex, node.endIndex, node_ordinal),
    kind,
    start: node.startIndex,
    end: node.endIndex,
    children: node.children.map((child) => baba_cst_node(child, ordinal)),
  };
}

function collect_separated_immediate_type_arguments(
  node: BabaCstNode,
  source: string,
  separated: BabaCstNode[],
): void {
  if (node.kind === "type_application") {
    const argument_index = node.children.findIndex((child) =>
      child.kind === "immediate_type_argument"
    );
    if (argument_index > 0) {
      const argument = node.children[argument_index];
      const constructor = node.children[argument_index - 1];
      expect(
        argument !== undefined && constructor !== undefined,
        "Baba immediate type application children disappeared.",
      );
      if (source.slice(constructor.end, argument.start).length > 0) {
        separated.push(argument);
      }
    }
  }
  for (const child of node.children) {
    collect_separated_immediate_type_arguments(child, source, separated);
  }
}

function render_cst(node: BabaCstNode): string {
  if (node.children.length === 0) {
    return node.kind;
  }

  let rendered = "(" + node.kind;
  for (const child of node.children) {
    rendered += " " + render_cst(child);
  }
  return rendered + ")";
}

function source_node_id(
  kind: string,
  start: number,
  end: number,
  ordinal: number,
): BabaSourceNodeId {
  return `${kind}:${start}:${end}:${ordinal}` as BabaSourceNodeId;
}

function collect_error_nodes(node: BabaCstNode, errors: BabaCstNode[]): void {
  if (node.kind === "ERROR" || node.kind === "MISSING") errors.push(node);
  for (const child of node.children) {
    collect_error_nodes(child, errors);
  }
}

function baba_tokens(
  root: TreeSitterNode,
  source: string,
): BabaToken[] {
  const tokens: BabaToken[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    expect(node !== undefined, "Baba token work disappeared.");
    if (node.children.length === 0 && node.endIndex > node.startIndex) {
      tokens.push({
        kind: node.type,
        text: source.slice(node.startIndex, node.endIndex),
        start: node.startIndex,
        end: node.endIndex,
      });
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      expect(child !== undefined, "Baba token child disappeared.");
      pending.push(child);
    }
  }
  return tokens;
}

function deep_freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const object_value = value as object;
  const keys = Reflect.ownKeys(object_value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = Object.getOwnPropertyDescriptor(object_value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deep_freeze(descriptor.value, seen);
    }
  }
  Object.freeze(object_value);
}
