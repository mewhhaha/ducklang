import type { FrontExpr } from "./ast.ts";

const text_encoder = new TextEncoder();
const text_decoder = new TextDecoder("utf-8", { fatal: true });

export function text_byte_length(value: string): number {
  return text_encoder.encode(value).length;
}

export function text_content_bytes(value: string): number[] {
  return Array.from(text_encoder.encode(value));
}

export function concat_visible_text_values(
  left: FrontExpr,
  right: FrontExpr,
): FrontExpr | undefined {
  if (left.tag === "text" && right.tag === "text") {
    if (left.encoding !== right.encoding) {
      return undefined;
    }

    return {
      tag: "text",
      value: left.value + right.value,
      encoding: left.encoding,
    };
  }

  if (left.tag === "if") {
    const then_branch = concat_visible_text_values(left.then_branch, right);
    const else_branch = concat_visible_text_values(left.else_branch, right);

    if (!then_branch || !else_branch) {
      return undefined;
    }

    return {
      tag: "if",
      cond: left.cond,
      then_branch,
      else_branch,
    };
  }

  if (right.tag === "if") {
    const then_branch = concat_visible_text_values(left, right.then_branch);
    const else_branch = concat_visible_text_values(left, right.else_branch);

    if (!then_branch || !else_branch) {
      return undefined;
    }

    return {
      tag: "if",
      cond: right.cond,
      then_branch,
      else_branch,
    };
  }

  return undefined;
}

export function slice_visible_text_value(
  value: FrontExpr,
  start: number,
  end: number,
): FrontExpr | undefined {
  if (value.tag === "if") {
    const then_branch = slice_visible_text_value(
      value.then_branch,
      start,
      end,
    );
    const else_branch = slice_visible_text_value(
      value.else_branch,
      start,
      end,
    );

    if (!then_branch || !else_branch) {
      return undefined;
    }

    return {
      tag: "if",
      cond: value.cond,
      then_branch,
      else_branch,
    };
  }

  if (value.tag !== "text") {
    return undefined;
  }

  const bytes = text_encoder.encode(value.value);
  if (start < 0) {
    throw new Error("Text slice start out of bounds");
  }

  if (end < start) {
    throw new Error("Text slice end before start");
  }

  if (end > bytes.length) {
    throw new Error("Text slice end out of bounds");
  }

  try {
    return {
      tag: "text",
      value: text_decoder.decode(bytes.slice(start, end)),
      encoding: value.encoding,
    };
  } catch {
    throw new Error("Text slice must preserve valid UTF-8");
  }
}
