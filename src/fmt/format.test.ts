import { assert_equals } from "../assert.ts";
import { format_source } from "../frontend/format.ts";
import { Source } from "../frontend.ts";
import { format_text } from "./format.ts";

Deno.test("format_text normalizes spacing around operators", () => {
  assert_equals(
    format_text("let value=1+2*3;\n"),
    "let value = 1 + 2 * 3;\n",
  );
});

Deno.test("format_text keeps unary sigils tight", () => {
  assert_equals(
    format_text("let  measure=( message :Text )=>do\n@len( &message )\nend;\n"),
    "let measure = (message: Text) => do\n  @len(&message)\nend;\n",
  );
});

Deno.test("format_text preserves logical-not call parentheses", () => {
  assert_equals(
    format_text("let empty=!f();\nlet value=!f(1);\n"),
    "let empty = !f();\nlet value = !f(1);\n",
  );
});

Deno.test("format_text uses whitespace for atomic unary calls", () => {
  assert_equals(
    format_text(
      "let direct=func(a);\n" +
        "let spaced=func (a);\n" +
        "let passed=func;\n" +
        "let grouped=func(a+b);\n" +
        "let packed=func(a,b);\n",
    ),
    "let direct = func a;\n" +
      "let spaced = func a;\n" +
      "let passed = func;\n" +
      "let grouped = func (a + b);\n" +
      "let packed = func (a, b);\n",
  );
});

Deno.test("format_text preserves tight parenthesized type applications", () => {
  const source = "type Alias = Type(value)\n";
  const formatted = format_text(source);

  assert_equals(formatted, "type Alias = Type (value)\n");
  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
});

Deno.test("format_text round trips prefix refinement signatures", () => {
  const source = "type keep = " +
    "(value: {refined: I32 | refined = refined}) -> " +
    "(result: {answer: I32 | answer = value})\n" +
    "let keep = value => value;\n";
  const formatted = format_text(source);
  assert_equals(
    formatted,
    "type keep = (value: { refined: I32 | refined = refined }) -> (\n" +
      "  result: { answer: I32 | answer = value }\n" +
      ")\n" +
      "let keep = value => value;\n",
  );
  assert_equals(format_text(formatted), formatted);
});

Deno.test("format_text round trips direct proof declarations", () => {
  const source = "type keep=(value:I32,evidence:Proof value=value)" +
    "->Proof value=value\n" +
    "let keep=(actual,proof)=>by proof;\n";
  const formatted = format_text(source);
  assert_equals(
    formatted,
    "type keep = " +
      "(value: I32, evidence: Proof value = value) -> Proof value = value\n" +
      "let keep = (actual, proof) => by proof;\n",
  );
  assert_equals(format_text(formatted), formatted);
});

Deno.test("format_text round trips tactic blocks", () => {
  const source = "type keep=(theorem:Proof True implies True)->" +
    "Proof True implies True\n" +
    "let keep=theorem=>by{intro evidence apply theorem assumption};\n" +
    "type choose=(choice:Proof True or True)->Proof True\n" +
    "let choose=choice=>by{cases choice assumption assumption};\n" +
    "type change=(left:I32,right:I32,equality:Proof left=right," +
    "evidence:Proof right=right)->Proof left=left\n" +
    "let change=(left,right,equality,evidence)=>" +
    "by{rewrite equality exact evidence};\n" +
    "type small=()->Proof 1i32<2i32\n" +
    "let small=()=>by{decide};\n";
  const formatted = format_text(source);
  assert_equals(
    formatted,
    "type keep = (theorem: Proof True implies True) -> " +
      "Proof True implies True\n" +
      "let keep = theorem => " +
      "by { intro evidence apply theorem assumption };\n" +
      "type choose = (choice: Proof True or True) -> Proof True\n" +
      "let choose = choice => " +
      "by { cases choice assumption assumption };\n" +
      "type change = (\n" +
      "  left: I32,\n" +
      "  right: I32,\n" +
      "  equality: Proof left = right,\n" +
      "  evidence: Proof right = right,\n" +
      ") -> Proof left = left\n" +
      "let change =\n" +
      "  (left, right, equality, evidence) => " +
      "by { rewrite equality exact evidence };\n" +
      "type small = () -> Proof 1i32 < 2i32\n" +
      "let small = () => by { decide };\n",
  );
  assert_equals(format_text(formatted), formatted);
});

Deno.test("format_text round trips propositional proof terms", () => {
  const source = "type merge=(choice:Proof True or True)->Proof True\n" +
    "let merge=choice=>by or_cases(choice,left=>left,right=>right);\n" +
    "type implication=()->Proof True implies True\n" +
    "let implication=()=>by evidence=>evidence;\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "type merge = (choice: Proof True or True) -> Proof True\n" +
      "let merge = choice => " +
      "by or_cases(choice, left => left, right => right);\n" +
      "type implication = () -> Proof True implies True\n" +
      "let implication = () => by evidence => evidence;\n",
  );
  assert_equals(format_text(formatted), formatted);

  const wide = "type choose = " +
    "(choice: Proof True or True) -> Proof True or True\n" +
    "let choose = choice => " +
    "by or_cases(choice, left => or_left(left), " +
    "right => or_right(right));\n";
  const wide_formatted = format_text(wide);
  assert_equals(format_text(wide_formatted), wide_formatted);
});

Deno.test("format_text round trips quantified proof terms", () => {
  const source = "type specialize=" +
    "(universal:Proof forall(value:I32).value=value,value:I32)" +
    "->Proof value=value\n" +
    "let specialize=(universal,value)=>" +
    "by forall_apply(universal,value);\n" +
    "type open=(existence:Proof exists(value:I32).True)->Proof True\n" +
    "let open=existence=>by exists_elim(" +
    "existence,witness,evidence=>evidence);\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "type specialize = (\n" +
      "  universal: Proof forall (value: I32).value = value,\n" +
      "  value: I32,\n" +
      ") -> Proof value = value\n" +
      "let specialize = (universal, value) => " +
      "by forall_apply(universal, value);\n" +
      "type open = " +
      "(existence: Proof exists (value: I32).True) -> Proof True\n" +
      "let open =\n" +
      "  existence => " +
      "by exists_elim(existence, witness, evidence => evidence);\n",
  );
  assert_equals(format_text(formatted), formatted);

  const wide = "type repack = " +
    "(package: Proof exists (value: I32). value = value) -> " +
    "Proof exists (copy: I32). copy = copy\n" +
    "let repack = package => by exists_elim(" +
    "package, witness, evidence => exists_intro(witness, evidence));\n";
  const wide_formatted = format_text(wide);
  assert_equals(format_text(wide_formatted), wide_formatted);
});

Deno.test("format_text round trips unsafe proof assumptions", () => {
  const source = "type admitted=()->Proof False\n" +
    "unsafe let admitted=()=>by unsafe{assume False};\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "type admitted = () -> Proof False\n" +
      "unsafe let admitted = () => by unsafe { assume False };\n",
  );
  assert_equals(format_text(formatted), formatted);
});

Deno.test("format_text round trips equality transformation proofs", () => {
  const source = "type mapped=(left:I32,right:I32,equality:Proof left=right)" +
    "->Proof left=right\n" +
    "let mapped=(left,right,equality)=>" +
    "by congr(value=>value,equality);\n" +
    "type moved=(left:I32,right:I32,equality:Proof left=right," +
    "evidence:Proof predicate(left))->Proof predicate(right)\n" +
    "let moved=(left,right,equality,evidence)=>" +
    "by transport(equality,value=>predicate(value),evidence);\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "type mapped =\n" +
      "  (left: I32, right: I32, equality: Proof left = right) -> " +
      "Proof left = right\n" +
      "let mapped = (left, right, equality) => " +
      "by congr(value => value, equality);\n" +
      "type moved = (\n" +
      "  left: I32,\n" +
      "  right: I32,\n" +
      "  equality: Proof left = right,\n" +
      "  evidence: Proof predicate (left),\n" +
      ") -> Proof predicate (right)\n" +
      "let moved = (left, right, equality, evidence) => by transport(\n" +
      "  equality,\n" +
      "  value => predicate (value),\n" +
      "  evidence,\n" +
      ");\n",
  );
  assert_equals(format_text(formatted), formatted);
});

Deno.test("format_text normalizes expressions inside template literals", () => {
  assert_equals(
    format_text('render   `hello { name+ "!" } {{reader}}`\n'),
    'render `hello {name + "!"} {{reader}}`\n',
  );
});

Deno.test("format_text separates prefix operators from fixity assignment", () => {
  assert_equals(
    format_text("prefix 80 ! = @syntax.not\n"),
    "prefix 80 ! = @syntax.not\n",
  );
});

Deno.test("format_text indents keyword blocks", () => {
  assert_equals(
    format_text("for i in 1..5 do\nif i==2 then\nbreak;\nend\nend\n"),
    "for i in 1..5 do\n  if i == 2 then\n    break;\n  end\nend\n",
  );
});

Deno.test("format_text places block closers after terminated statements", () => {
  const source = "for candidate in candidates do\n" +
    "if not(is_utf8_continuation candidate) then break; end\n" +
    "end\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "for candidate in candidates do\n" +
      "  if not (is_utf8_continuation candidate) then\n" +
      "    break;\n" +
      "  end\n" +
      "end\n",
  );
  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
});

Deno.test("format_text expands inline statements into their keyword scopes", () => {
  assert_equals(
    format_text(
      "if ready then value=1 else value=2 end;\n" +
        "let #Some item = selected else do return fallback; end;\n" +
        "let chosen=if ready then 1 else 2 end;\n",
    ),
    "if ready then\n" +
      "  value = 1\n" +
      "else\n" +
      "  value = 2\n" +
      "end;\n" +
      "let #Some item = selected else do\n" +
      "  return fallback;\n" +
      "end;\n" +
      "let chosen = if ready then 1 else 2 end;\n",
  );
});

Deno.test("format_text keeps end fields inside their enclosing scope", () => {
  assert_equals(
    format_text(
      "loop do\n" +
        "let boundary={.start=0,.end=finish};\n" +
        "if ready then finish=finish+1 end;\n" +
        "end\n",
    ),
    "loop do\n" +
      "  let boundary = { .start = 0, .end = finish };\n" +
      "  if ready then\n" +
      "    finish = finish + 1\n" +
      "  end;\n" +
      "end\n",
  );
});

Deno.test("format_text keeps let else blocks inside conditional branches", () => {
  assert_equals(
    format_text(
      "if ready then\n" +
        "let #Some value = result else do return 0; end;\n" +
        "value\n" +
        "else\n" +
        "0\n" +
        "end\n",
    ),
    "if ready then\n" +
      "  let #Some value = result else do\n" +
      "    return 0;\n" +
      "  end;\n" +
      "  value\n" +
      "else\n" +
      "  0\n" +
      "end\n",
  );
});

Deno.test("format_text wraps wide definitions before their value", () => {
  const source = "let update = () => do\n" +
    "if has_selection then\n" +
    "let furthest = if selection.anchor\n" +
    "> selection.head " +
    "then selection.anchor else selection.head end;\n" +
    "end\n" +
    "end;\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "let update = () => do\n" +
      "  if has_selection then\n" +
      "    let furthest =\n" +
      "      if selection.anchor > selection.head then\n" +
      "        selection.anchor\n" +
      "      else\n" +
      "        selection.head\n" +
      "      end;\n" +
      "  end\n" +
      "end;\n",
  );
  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
});

Deno.test("format_text keeps a comparison together after a conditional", () => {
  assert_equals(
    format_text(
      "let visible_rows =\n" +
        "  if document_rows\n" +
        "  > minimum_document_rows then document_rows else minimum_document_rows end;\n",
    ),
    "let visible_rows =\n" +
      "  if document_rows > minimum_document_rows then\n" +
      "    document_rows\n" +
      "  else\n" +
      "    minimum_document_rows\n" +
      "  end;\n",
  );
});

Deno.test("format_text keeps a wide single typed lambda parameter parseable", () => {
  const source =
    "let has_next = (state: ZippedIteratorState left_state right_state left_item right_item) => do\n" +
    "true\n" +
    "end;\n";
  const formatted = format_text(source);

  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
});

Deno.test("format_text indents union alternatives", () => {
  assert_equals(
    format_text("type Option t =\n| #Some t\n| #None\n"),
    "type Option t =\n  | #Some t\n  | #None\n",
  );
});

Deno.test("format_text indents case arms", () => {
  assert_equals(
    format_text(
      "case value of\n#Some item => item,\n#None => 0\n;\n",
    ),
    "case value of\n  #Some item => item,\n  #None => 0;\n",
  );
});

Deno.test("format_text preserves comments", () => {
  assert_equals(
    format_text("//header\nlet value = 1; //trailing\n"),
    "// header\nlet value = 1; // trailing\n",
  );
});

Deno.test("format_text collapses blank runs", () => {
  assert_equals(
    format_text("\n\nlet a = 1;\n\n\n\nlet b = 2;\n\n"),
    "let a = 1;\n\nlet b = 2;\n",
  );
});

Deno.test("format_text drops blanks hugging blocks", () => {
  assert_equals(
    format_text("let f = () => do\n\nlet a = 1;\na\n\nend;\n"),
    "let f = () => do\n  let a = 1;\n  a\nend;\n",
  );
});

Deno.test("format_text keeps effect rows tight", () => {
  assert_equals(
    format_text(
      "let echo: () -> < Stdin :|Stdout > Text = () => do\n1\nend;\n",
    ),
    "let echo: () -> <Stdin :| Stdout> Text = () => do\n  1\nend;\n",
  );
});

Deno.test("format_text preserves fixed array separators", () => {
  assert_equals(
    format_text(
      "type Pixels=[Int;2]\nlet pixels=[20;2];\nlet pack:(Int;2)=(1,2);\n",
    ),
    "type Pixels = [Int; 2]\nlet pixels = [20; 2];\n" +
      "let pack: (Int; 2) = (1, 2);\n",
  );
});

Deno.test("format_text distinguishes product arguments from indexes", () => {
  assert_equals(
    format_text("let projected=value[0];\nlet built=Point.make [1,2];\n"),
    "let projected = value[0];\nlet built = Point.make [1, 2];\n",
  );
});

Deno.test("format_text preserves the empty Bytes value", () => {
  assert_equals(
    format_text("let bytes:Bytes=Bytes.empty;\n"),
    "let bytes: Bytes = Bytes.empty;\n",
  );
});

Deno.test("format_text canonicalizes string escapes", () => {
  assert_equals(
    format_text('let message = "line\\none";\n'),
    'let message = "line\\none";\n',
  );
});

Deno.test("format_text indents multiline binding values", () => {
  assert_equals(
    format_text("let apply: Int -> Int =\n(value: Int) => do\nvalue\nend;\n"),
    "let apply: Int -> Int =\n  (value: Int) => do\n    value\n  end;\n",
  );
});

Deno.test("format_text composes wide products vertically", () => {
  const source = "let settings = " +
    "[.foreground_color = foreground_color, " +
    ".background_color = background_color, " +
    ".selection_color = selection_color];\n";
  const formatted = format_text(source);

  assert_equals(
    formatted,
    "let settings = [\n" +
      "  .foreground_color = foreground_color,\n" +
      "  .background_color = background_color,\n" +
      "  .selection_color = selection_color,\n" +
      "];\n",
  );

  for (const line of formatted.split("\n")) {
    assert_equals(line.length <= 80, true);
  }

  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
});

Deno.test("format_text composes a wide grouped expression vertically", () => {
  assert_equals(
    format_text(
      "let selected = choose(" +
        "very_long_foreground_configuration_with_platform_overrides + " +
        "additional_configuration_defaults);\n",
    ),
    "let selected = choose (\n" +
      "  very_long_foreground_configuration_with_platform_overrides\n" +
      "  + additional_configuration_defaults\n" +
      ");\n",
  );
});

Deno.test("format_text only wraps expressions at parseable continuations", () => {
  const source = "let valid = first_really_long_condition_name == 1 && " +
    "second_really_long_condition_name == 2 && " +
    "third_really_long_condition_name == 3;\n";
  const formatted = format_text(source);

  assert_equals(
    format_source(Source.parse(formatted)),
    format_source(Source.parse(source)),
  );
  assert_equals(formatted.includes("\n  == 2"), true);
});

Deno.test("format_text preserves every bundled prelude", async () => {
  const paths: string[] = [];

  for await (const entry of Deno.readDir("src/frontend")) {
    if (entry.isFile && /^prelude.*\.duck$/.test(entry.name)) {
      paths.push("src/frontend/" + entry.name);
    }
  }

  paths.sort();

  for (const path of paths) {
    const source = await Deno.readTextFile(path);
    const formatted = format_text(source);
    assert_equals(
      format_source(Source.parse(formatted)),
      format_source(Source.parse(source)),
      "format_text changed the parse of " + path,
    );
  }
});

Deno.test("format_text preserves the examples and Duck editor sources", async () => {
  const roots = ["examples"];
  const files: string[] = [];

  while (roots.length > 0) {
    const root = roots.pop();

    if (root === undefined) {
      continue;
    }

    for await (const entry of Deno.readDir(root)) {
      const path = root + "/" + entry.name;

      if (entry.isDirectory) {
        roots.push(path);
      } else if (entry.name.endsWith(".duck")) {
        files.push(path);
      }
    }
  }

  files.sort();
  files.push(
    "case-studies/editor/editor.duck",
    "case-studies/editor/editor_core.duck",
    "case-studies/editor/piece_tree.duck",
    "case-studies/editor/piece_tree_fixture.duck",
    "case-studies/editor/terminal_keys.duck",
  );
  assert_equals(files.length > 0, true);

  for (const path of files) {
    const text = await Deno.readTextFile(path);
    const formatted = format_text(text);
    assert_equals(
      format_text(formatted),
      formatted,
      "format_text is not idempotent for " + path,
    );

    let original;

    try {
      original = Source.parse(text);
    } catch {
      // Examples that do not parse today are out of formatting scope.
      continue;
    }

    const reparsed = Source.parse(formatted);
    assert_equals(
      format_source(reparsed),
      format_source(original),
      "format_text changed the parse of " + path,
    );
  }
});
