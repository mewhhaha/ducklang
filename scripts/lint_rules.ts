/**
 * Project lint rules, enforced by `deno lint` so they run wherever the normal
 * lint runs. These encode the style rules in AGENTS.md that are mechanically
 * checkable; the rest stay prose.
 */
export default {
  name: "ducklang",
  rules: {
    // AGENTS.md: "Do not use ternary expressions." Type-level conditionals are
    // a different node and stay allowed.
    "no-value-ternary": {
      create(context) {
        return {
          ConditionalExpression(node) {
            context.report({
              node,
              message: "Ternary expression",
              hint:
                "Use an explicit if block, a hoisted local, or a named helper.",
            });
          },
        };
      },
    },

    // AGENTS.md: "Do not use the nullish coalescing operator."
    "no-nullish-coalescing": {
      create(context) {
        return {
          'LogicalExpression[operator="??"]'(node) {
            context.report({
              node,
              message: "Nullish coalescing operator",
              hint:
                "Missing compiler information should throw, not silently default.",
            });
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
