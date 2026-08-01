import { assert_equals, assert_includes } from "../../src/assert.ts";
import { Source } from "../../src/frontend.ts";
import { build_binding_index } from "../../src/frontend/binding_index.ts";
import { parse_source_with_diagnostics } from "../../src/frontend/parser.ts";
import { source_facts } from "../../src/frontend/source_facts.ts";
import { hover } from "../../src/lsp/hover.ts";
import { create_state, handle_message } from "../../src/lsp/server.ts";
import { main } from "./editor.ts";
import { mock_runner } from "./host.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

Deno.test("editor source infers local types without diagnostics", () => {
  const source_url = new URL("./editor.duck", import.meta.url);
  const host_url = new URL("./host.duck", import.meta.url);
  const analysis = Source.analyze_file(source_url.href, {
    host_interface: Source.load(host_url.href),
    warnings: true,
  });

  assert_equals(analysis.diagnostics, []);
});

Deno.test("editor opens in the language server without diagnostics", async () => {
  const source_url = new URL("./editor.duck", import.meta.url);
  const root_url = new URL("../../", import.meta.url);
  const state = create_state();
  handle_message(state, {
    id: 1,
    method: "initialize",
    params: { rootUri: root_url.href },
  });
  const messages = handle_message(state, {
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: source_url.href,
        languageId: "duck",
        version: 1,
        text: await Deno.readTextFile(source_url),
      },
    },
  }) as [{
    params: {
      diagnostics: unknown[];
    };
  }];

  assert_equals(messages[0]?.params.diagnostics, []);
});

Deno.test("editor language service retains inferred local structure", async () => {
  const editor_url = new URL("./editor.duck", import.meta.url);
  const core_url = new URL("./editor_core.duck", import.meta.url);
  const editor_text = await Deno.readTextFile(editor_url);
  const core_text = await Deno.readTextFile(core_url);
  const editor_parsed = parse_source_with_diagnostics(editor_text);
  const core_parsed = parse_source_with_diagnostics(core_text);
  const compiler_facts = source_facts(core_parsed.source);
  const furthest = compiler_facts.statements.find((statement) => {
    return statement.tag === "bind" && statement.name === "furthest";
  });

  if (furthest === undefined) {
    throw new Error("Missing furthest editor binding");
  }

  const compiler_type_before = compiler_facts.definition_type_of.get(furthest)
    ?.get("name")?.name;
  const core_index = build_binding_index(core_parsed, 1);
  const editor_index = build_binding_index(editor_parsed, 1);

  assert_equals(
    source_facts(core_parsed.source).definition_type_of.get(furthest)?.get(
      "name",
    )
      ?.name,
    compiler_type_before,
  );

  assert_equals(core_text.includes("as PieceSplit"), false);

  for (
    const expected of [
      {
        text: editor_text,
        parsed: editor_parsed,
        index: editor_index,
        needle: "output = output_builder",
        type: "OutputBuilder",
      },
      {
        text: core_text,
        parsed: core_parsed,
        index: core_index,
        needle: "mode = if let #Extend",
        type: "EditorMode",
      },
      {
        text: editor_text,
        parsed: editor_parsed,
        index: editor_index,
        needle: "visible_rows =",
        type: "I32",
      },
    ]
  ) {
    const offset = expected.text.indexOf(expected.needle);
    const result = hover(
      expected.parsed.source,
      expected.parsed.syntax,
      expected.index,
      offset,
      "utf-16",
    );

    if (result === undefined) {
      throw new Error("Missing editor hover for " + expected.needle);
    }

    assert_includes(result.contents.value, ": " + expected.type);
  }
});

Deno.test("editor inserts saves and renders through the terminal effect", async () => {
  const runner = mock_runner(encoder.encode("abc"), [
    encoder.encode("iX"),
    encoder.encode("\x1b"),
    encoder.encode("wq"),
  ]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.frames.length, 3);
    assert_equals(runner.saves.map((value) => decoder.decode(value)), [
      "Xabc",
    ]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor appends consecutive insert batches at the document end", async () => {
  const runner = mock_runner(new Uint8Array(), [
    encoder.encode("iabc"),
    encoder.encode("def"),
    encoder.encode("\x1bwq"),
  ]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), [
      "abcdef",
    ]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor saves the document from each command position", async () => {
  const runner = mock_runner(encoder.encode("abc"), [encoder.encode("wdwq")]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), [
      "abc",
      "bc",
    ]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor stops applying an input batch after quit", async () => {
  const runner = mock_runner(encoder.encode("abc"), [encoder.encode("wqdw")]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), ["abc"]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor applies Escape before an ordinary key in the same batch", async () => {
  const runner = mock_runner(new Uint8Array(), [
    encoder.encode("iA\x1bdwq"),
  ]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), [""]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor displays the host save failure message", async () => {
  const runner = mock_runner(
    encoder.encode("abc"),
    [encoder.encode("w"), encoder.encode("q")],
    { save_error: "disk full" },
  );

  try {
    assert_equals(await main(runner), { code: 0 });
    const failed_frame = runner.frames.at(-1);

    if (failed_frame === undefined) {
      throw new Error("Missing editor frame after failed save");
    }

    assert_includes(
      decoder.decode(failed_frame),
      "SAVE FAILED: disk full",
    );
  } finally {
    runner.dispose();
  }
});

Deno.test("editor movement and deletion respect UTF-8 code point boundaries", async () => {
  const runner = mock_runner(encoder.encode("a老b"), [encoder.encode("vldwq")]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), ["b"]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor handles arrow keys and Ctrl-C as terminal controls", async () => {
  const runner = mock_runner(encoder.encode("abc"), [
    encoder.encode("\x1b["),
    encoder.encode("Cdw"),
    Uint8Array.of(3),
  ]);

  try {
    assert_equals(await main(runner), { code: 0 });
    assert_equals(runner.saves.map((value) => decoder.decode(value)), ["ac"]);
  } finally {
    runner.dispose();
  }
});

Deno.test("editor random insert histories match a contiguous byte model", async () => {
  for (let seed = 1; seed <= 5; seed += 1) {
    let random_state = seed;
    const expected_bytes: number[] = [];
    const terminal_input: number[] = ["i".charCodeAt(0)];
    let cursor = 0;

    for (let operation_index = 0; operation_index < 80; operation_index += 1) {
      random_state = (
        Math.imul(random_state, 1_664_525) + 1_013_904_223
      ) >>> 0;
      const operation = random_state % 4;

      if (operation === 0) {
        const byte = 97 + (random_state % 6);
        terminal_input.push(byte);
        expected_bytes.splice(cursor, 0, byte);
        cursor += 1;
      } else if (operation === 1) {
        terminal_input.push(27, 91, 68);

        if (cursor > 0) {
          cursor -= 1;
        }
      } else if (operation === 2) {
        terminal_input.push(27, 91, 67);

        if (cursor < expected_bytes.length) {
          cursor += 1;
        }
      } else {
        terminal_input.push(127);

        if (cursor > 0) {
          expected_bytes.splice(cursor - 1, 1);
          cursor -= 1;
        }
      }
    }

    terminal_input.push(27, 119, 113);
    const runner = mock_runner(
      new Uint8Array(),
      [Uint8Array.from(terminal_input)],
    );

    try {
      assert_equals(await main(runner), { code: 0 });
      const saved = runner.saves[0];

      if (saved === undefined) {
        throw new Error("Random editor history seed " + seed + " did not save");
      }

      const expected = decoder.decode(Uint8Array.from(expected_bytes));
      const actual = decoder.decode(saved);

      if (actual !== expected) {
        throw new Error(
          "Random editor history seed " + seed + " saved " +
            JSON.stringify(actual) + " instead of " + JSON.stringify(expected),
        );
      }
    } finally {
      runner.dispose();
    }
  }
});
