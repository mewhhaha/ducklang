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

export function is_trusted_baba_parse_result(
  value: unknown,
): value is BabaParseResult {
  return value !== null && typeof value === "object" &&
    trusted_baba_parse_results.has(value);
}

/** Parse Duck source with the generated Baba Tree-sitter parser. */
export function parse_duck_source(text: string): BabaParseResult {
  const temporary_path = Deno.makeTempFileSync({ suffix: ".duck" });

  try {
    Deno.writeTextFileSync(temporary_path, text);
    const result = new Deno.Command("tree-sitter", {
      args: [
        "parse",
        "--grammar-path",
        new URL("../../tree-sitter-duck/", import.meta.url).pathname,
        "--cst",
        temporary_path,
      ],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const tree = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    const parsed_tree = parse_cst_tree(tree, text);
    const diagnostics: SyntaxDiagnostic[] = [];
    const structural_errors: BabaCstNode[] = [];
    if (parsed_tree.root !== undefined) {
      collect_error_nodes(parsed_tree.root, structural_errors);
    }
    const recovery_errors = missing_error_nodes(tree + "\n" + stderr, text, parsed_tree.root);
    if (!result.success || structural_errors.length > 0 || recovery_errors.length > 0) {
      const errors = new Map<string, BabaCstNode>();
      for (let index = 0; index < structural_errors.length; index += 1) {
        const error_node = structural_errors[index];
        if (error_node === undefined) continue;
        errors.set(error_key(error_node), error_node);
      }
      for (let index = 0; index < recovery_errors.length; index += 1) {
        const error_node = recovery_errors[index];
        if (error_node === undefined) continue;
        errors.set(error_key(error_node), error_node);
      }
      const ordered_errors = [...errors.values()].sort((left, right) => {
        if (left.start !== right.start) return left.start - right.start;
        return left.end - right.end;
      });
      for (let index = 0; index < ordered_errors.length; index += 1) {
        const error_node = ordered_errors[index];
        if (error_node === undefined) continue;
        diagnostics.push({
          message: `Baba parser rejected ${error_node.kind}`,
          span: { start: error_node.start, end: error_node.end },
        });
      }
      if (diagnostics.length === 0) {
        diagnostics.push({
          message: "Baba parser rejected source",
          span: { start: 0, end: text.length },
        });
      }
    }

    const parsed = {
      tokens: cst_tokens(parsed_tree.root, text),
      diagnostics,
      cst: { text, tree, root: parsed_tree.root },
    };
    deep_freeze(parsed);
    trusted_baba_parse_results.add(parsed);
    return parsed;
  } finally {
    Deno.removeSync(temporary_path);
  }
}

function missing_error_nodes(
  output: string,
  source: string,
  root: BabaCstNode | undefined,
): BabaCstNode[] {
  const pattern = /\(MISSING\s+[^[]+\[(\d+),\s*(\d+)\]\s*-\s*\[(\d+),\s*(\d+)\]\)/g;
  const offsets = source_line_offsets(source);
  const errors: BabaCstNode[] = [];
  let ordinal = 0;
  if (root !== undefined) ordinal = root.end + 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const start = source_offset(source, offsets, Number(match[1]), Number(match[2]));
    const end = source_offset(source, offsets, Number(match[3]), Number(match[4]));
    errors.push({
      id: source_node_id("MISSING", start, end, ordinal),
      kind: "MISSING",
      start,
      end,
      children: [],
    });
    ordinal += 1;
  }
  return errors;
}

type ParsedCstEntry = Omit<BabaCstNode, "children"> & {
  depth: number;
  children: ParsedCstEntry[];
};

function parse_cst_tree(
  tree: string,
  source: string,
): { root: BabaCstNode | undefined } {
  const entries: ParsedCstEntry[] = [];
  const lines = source_line_offsets(source);

  for (const line of tree.split("\n")) {
    const match = line.match(
      /^(\d+):(\d+)\s+-\s+(\d+):(\d+)(.*)$/,
    );
    if (match === null) continue;

    const start = source_offset(source, lines, Number(match[1]), Number(match[2]));
    const end = source_offset(source, lines, Number(match[3]), Number(match[4]));
    const remainder = match[5];
    const label = remainder.trim().replace(/^•/, "").trim();
    const indentation = remainder.length - remainder.trimStart().length;
    const coordinate_width = line.length - remainder.length;
    let depth = coordinate_width + indentation;
    if (remainder.trimStart().startsWith("•")) depth += 1;
    const node: ParsedCstEntry = {
      id: source_node_id(label, start, end, entries.length),
      kind: cst_kind(label),
      start,
      end,
      children: [],
      depth,
    };
    entries.push(node);
  }

  const stack: ParsedCstEntry[] = [];
  let root: ParsedCstEntry | undefined;
  for (const entry of entries) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= entry.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      root = entry;
    } else {
      parent.children.push(entry);
    }
    stack.push(entry);
  }

  if (root === undefined) {
    return { root: undefined };
  }
  return { root: without_depth(root) };
}

function without_depth(node: ParsedCstEntry): BabaCstNode {
  return {
    id: node.id,
    kind: node.kind,
    start: node.start,
    end: node.end,
    children: node.children.map(without_depth),
  };
}

function cst_kind(label: string): string {
  if (label.startsWith("MISSING")) return "MISSING";
  if (label.startsWith("ERROR")) return "ERROR";
  const backtick = label.indexOf(" `");
  if (backtick >= 0) {
    label = label.slice(0, backtick);
  }
  const field_separator = label.indexOf(": ");
  if (field_separator >= 0) {
    label = label.slice(field_separator + 2);
  }
  return label.replace(/^•/, "").trim();
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

function error_key(error: BabaCstNode): string {
  return `${error.kind}:${error.start}:${error.end}`;
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

function source_line_offsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function source_offset(
  source: string,
  offsets: number[],
  line: number,
  column: number,
): number {
  const line_start = offsets[line];
  if (line_start === undefined) {
    throw new Error(`Baba parser returned an invalid line ${line}.`);
  }
  const next_line_start = offsets[line + 1];
  let line_end = source.length;
  let newline_bytes = 0;
  if (next_line_start !== undefined) {
    line_end = next_line_start - 1;
    newline_bytes = 1;
    if (line_end > line_start && source[line_end - 1] === "\r") {
      line_end -= 1;
      newline_bytes = 2;
    }
  }
  let byte_offset = 0;
  let code_unit_offset = 0;
  while (line_start + code_unit_offset < line_end) {
    const character = source_line_character(source, line_start + code_unit_offset);
    if (character === undefined) break;
    const character_bytes = new TextEncoder().encode(character).length;
    if (byte_offset + character_bytes > column) break;
    byte_offset += character_bytes;
    code_unit_offset += character.length;
  }
  if (byte_offset === column) {
    return line_start + code_unit_offset;
  }
  if (next_line_start !== undefined && byte_offset + newline_bytes === column) {
    return next_line_start;
  }
  throw new Error(`Baba parser returned a non-boundary byte column ${column}.`);
}

function source_line_character(source: string, offset: number): string | undefined {
  const code_point = source.codePointAt(offset);
  if (code_point === undefined) return undefined;
  return String.fromCodePoint(code_point);
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
