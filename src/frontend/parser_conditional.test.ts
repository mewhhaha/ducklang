import { assert_equals, assert_throws } from "../assert.ts";
import { parse_source } from "./parser.ts";

Deno.test("if let accepts a product pattern inside a union case", () => {
  const source = parse_source(
    "let result = if let #Cons [head, tail] = current then head else tail end;",
  );
  const statement = source.statements[0];

  if (statement === undefined || statement.tag !== "bind") {
    throw new Error("Expected result binding");
  }

  if (statement.value.tag !== "match") {
    throw new Error("Expected structured if let to lower to a case");
  }

  assert_equals(statement.value.arms[0]?.pattern, {
    tag: "union_case",
    name: "Cons",
    value: {
      tag: "product",
      entries: [
        {
          pattern: {
            tag: "binding",
            name: "head",
            mode: "default",
            annotation: undefined,
          },
        },
        {
          pattern: {
            tag: "binding",
            name: "tail",
            mode: "default",
            annotation: undefined,
          },
        },
      ],
    },
  });
});

Deno.test("conditional branches are implicit blocks", () => {
  const source = parse_source(`
    let result = if ready then
      let value = first input;
      value
    else other input then
      second input
    else
      fallback input
    end;
  `);
  const statement = source.statements[0];

  if (statement === undefined || statement.tag !== "bind") {
    throw new Error("Expected result binding");
  }

  if (statement.value.tag !== "if") {
    throw new Error("Expected conditional binding value");
  }

  assert_equals(statement.value.then_branch.tag, "block");
  assert_equals(statement.value.else_branch.tag, "if");
});

Deno.test("case delimiters are reserved variable names", () => {
  assert_throws(
    () => parse_source("let case = 1;\n"),
    "`case` is reserved and cannot be used as a variable",
  );
  assert_throws(
    () => parse_source("let of = 1;\n"),
    "`of` is reserved and cannot be used as a variable",
  );
});
