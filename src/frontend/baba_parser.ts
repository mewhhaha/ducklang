import { Language, type Node as TreeSitterNode, Parser } from "web-tree-sitter";
import { expect } from "../expect.ts";
import type { SyntaxDiagnostic } from "./syntax.ts";

export type BabaToken = {
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

export type BabaParseResult = {
  tokens: BabaToken[];
  diagnostics: SyntaxDiagnostic[];
  cst: BabaCst;
};

const trusted_baba_parse_results = new WeakSet<object>();
await Parser.init();
const duck_language = await Language.load(
  new URL("../../tree-sitter-duck/tree-sitter-duck.wasm", import.meta.url)
    .pathname,
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
          excessive_node.startIndex,
          excessive_node.endIndex,
          1,
        ),
        kind: "ERROR",
        start: excessive_node.startIndex,
        end: excessive_node.endIndex,
        children: [],
      };
      const root: BabaCstNode = {
        id: source_node_id("source_file", 0, text.length, 0),
        kind: "source_file",
        start: 0,
        end: text.length,
        children: [error],
      };
      const parsed = {
        tokens: cst_tokens(root, text),
        diagnostics: [{
          message: "Baba parser nesting exceeds the maximum of " +
            maximum_baba_cst_nesting.toString(),
          span: { start: error.start, end: error.end },
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
    const errors: BabaCstNode[] = [];
    collect_error_nodes(root, errors);
    errors.sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      return left.end - right.end;
    });
    for (const error of errors) {
      diagnostics.push({
        message: `Baba parser rejected ${error.kind}`,
        span: { start: error.start, end: error.end },
      });
    }

    const parsed = {
      tokens: cst_tokens(root, text),
      diagnostics,
      cst: { text, tree: render_cst(root), root },
    };
    deep_freeze(parsed);
    trusted_baba_parse_results.add(parsed);
    return parsed;
  } finally {
    tree.delete();
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

function cst_tokens(
  root: BabaCstNode | undefined,
  source: string,
): BabaToken[] {
  const tokens: BabaToken[] = [];

  function visit(node: BabaCstNode): void {
    if (node.children.length === 0 && node.end > node.start) {
      tokens.push({
        text: source.slice(node.start, node.end),
        start: node.start,
        end: node.end,
      });
      return;
    }
    for (const child of node.children) visit(child);
  }

  if (root !== undefined) visit(root);
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
