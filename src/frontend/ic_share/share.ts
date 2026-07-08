import { expect } from "../../expect.ts";
import type { Ic as IcNode } from "../../ic.ts";
import { ic_share_label } from "../../ic/labels.ts";

type SharePlan = {
  leaves: string[];
  wrap: (body: IcNode) => IcNode;
};

export function share_ic_value(
  value: IcNode,
  body: IcNode,
  name: string,
  uses: number,
): IcNode {
  expect(uses > 1, "Shared Ic value must have multiple uses");
  const plan = create_share_plan(value, name, uses);
  const shared_body = replace_ic_name_with_leaves(body, name, plan.leaves);
  return plan.wrap(shared_body);
}

function create_share_plan(
  value: IcNode,
  name: string,
  uses: number,
): SharePlan {
  let next = 0;

  function create(expr: IcNode, remaining_uses: number): SharePlan {
    if (remaining_uses === 1) {
      expect(expr.tag === "var", "Expected Ic share leaf variable");
      return {
        leaves: [expr.name],
        wrap(body: IcNode): IcNode {
          return body;
        },
      };
    }

    const share_index = next;
    next += 1;
    const share_name = name + "_share" + share_index.toString();
    const left_name = share_name + "0";
    const right_name = share_name + "1";
    const right_plan = create(
      { tag: "var", name: right_name },
      remaining_uses - 1,
    );
    const leaves = [left_name, ...right_plan.leaves];

    return {
      leaves,
      wrap(body: IcNode): IcNode {
        return {
          tag: "dup",
          label: ic_share_label(name, share_index),
          name: share_name,
          expr,
          body: right_plan.wrap(body),
        };
      },
    };
  }

  return create(value, uses);
}

function replace_ic_name_with_leaves(
  ic: IcNode,
  name: string,
  leaves: string[],
): IcNode {
  let index = 0;

  function next_leaf(): IcNode {
    const leaf = leaves[index];
    expect(leaf, "Missing shared Ic leaf " + index.toString());
    index += 1;
    return { tag: "var", name: leaf };
  }

  function visit(node: IcNode): IcNode {
    switch (node.tag) {
      case "num":
      case "text":
        return node;

      case "var":
        if (node.name === name) {
          return next_leaf();
        }

        return node;

      case "prim":
        return {
          tag: "prim",
          prim: node.prim,
          args: node.args.map((arg) => visit(arg)),
        };

      case "lam":
        if (node.name === name) {
          return node;
        }

        return { tag: "lam", name: node.name, body: visit(node.body) };

      case "app":
        return {
          tag: "app",
          func: visit(node.func),
          arg: visit(node.arg),
        };

      case "sup":
        return {
          tag: "sup",
          label: node.label,
          left: visit(node.left),
          right: visit(node.right),
        };

      case "dup": {
        const expr = visit(node.expr);

        if (name === node.name + "0" || name === node.name + "1") {
          return {
            tag: "dup",
            label: node.label,
            name: node.name,
            expr,
            body: node.body,
          };
        }

        return {
          tag: "dup",
          label: node.label,
          name: node.name,
          expr,
          body: visit(node.body),
        };
      }

      case "era":
        return {
          tag: "era",
          expr: visit(node.expr),
          body: visit(node.body),
        };

      case "fix":
        if (node.name === name) {
          return node;
        }

        return {
          tag: "fix",
          name: node.name,
          expr: visit(node.expr),
          body: visit(node.body),
        };
    }
  }

  const result = visit(ic);
  expect(
    index === leaves.length,
    "Shared Ic use count changed for " + name,
  );
  return result;
}
