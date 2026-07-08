import { expect } from "../../expect.ts";
import { Ic, type Ic as IcNode } from "../../ic.ts";
import type { Env, FrontExpr } from "../ast.ts";
import { text_content_bytes } from "../text.ts";
import type { TextLowerHooks } from "../text_lower_types.ts";

type TextBranchBounds = "throw" | "trap";

export function lower_visible_text_byte_index(
  text: FrontExpr,
  index: number,
  env: Env,
  hooks: TextLowerHooks,
  bounds: TextBranchBounds = "throw",
): IcNode {
  if (text.tag === "text") {
    const bytes = text_content_bytes(text.value);

    if (index >= bytes.length) {
      if (bounds === "trap") {
        return { tag: "prim", prim: "i32.trap", args: [] };
      }

      throw new Error("Text index out of bounds: " + index.toString());
    }

    const value = bytes[index];
    expect(value !== undefined, "Missing text byte " + index.toString());
    return { tag: "num", type: "i32", value };
  }

  if (text.tag === "if") {
    const cond = Ic.reduce(hooks.lower_expr(text.cond, env));

    if (cond.tag === "num") {
      expect(cond.type === "i32", "Text byte if condition must lower to i32");
      const value = cond.value;
      expect(typeof value === "number", "Expected i32 text byte condition");

      if (value !== 0) {
        return lower_visible_text_byte_index(
          text.then_branch,
          index,
          env,
          hooks,
          bounds,
        );
      }

      return lower_visible_text_byte_index(
        text.else_branch,
        index,
        env,
        hooks,
        bounds,
      );
    }

    return {
      tag: "prim",
      prim: "i32.select",
      args: [
        lower_visible_text_byte_index(
          text.then_branch,
          index,
          env,
          hooks,
          "trap",
        ),
        lower_visible_text_byte_index(
          text.else_branch,
          index,
          env,
          hooks,
          "trap",
        ),
        cond,
      ],
    };
  }

  throw new Error(
    "Visible text byte index expected normalized text or if, got: " +
      text.tag,
  );
}

export function lower_dynamic_visible_text_byte_index(
  text: FrontExpr,
  index: FrontExpr,
  env: Env,
  hooks: TextLowerHooks,
): IcNode {
  check_text_index_type(index, env, hooks);

  if (text.tag === "text") {
    const bytes = text_content_bytes(text.value);
    let result: IcNode = { tag: "prim", prim: "i32.trap", args: [] };

    for (let pos = bytes.length - 1; pos >= 0; pos -= 1) {
      const byte = bytes[pos];
      expect(byte !== undefined, "Missing text byte " + pos.toString());
      result = {
        tag: "prim",
        prim: "i32.select",
        args: [
          { tag: "num", type: "i32", value: byte },
          result,
          {
            tag: "prim",
            prim: "i32.eq",
            args: [
              hooks.lower_expr(index, env),
              { tag: "num", type: "i32", value: pos },
            ],
          },
        ],
      };
    }

    return result;
  }

  if (text.tag === "if") {
    return {
      tag: "prim",
      prim: "i32.select",
      args: [
        lower_dynamic_visible_text_byte_index(
          text.then_branch,
          index,
          env,
          hooks,
        ),
        lower_dynamic_visible_text_byte_index(
          text.else_branch,
          index,
          env,
          hooks,
        ),
        hooks.lower_expr(text.cond, env),
      ],
    };
  }

  throw new Error(
    "Visible text byte index expected normalized text or if, got: " +
      text.tag,
  );
}

export function check_text_index_type(
  index: FrontExpr,
  env: Env,
  hooks: TextLowerHooks,
): void {
  const index_type = hooks.infer_expr(index, env);

  if (
    index_type.tag === "int" && index_type.type !== undefined &&
    index_type.type !== "i32"
  ) {
    throw new Error("Text index must be i32");
  }
}
