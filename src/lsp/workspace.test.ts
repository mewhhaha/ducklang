import { assert_equals } from "../assert.ts";
import type { TextDocument } from "./documents.ts";
import { workspace_symbols } from "./navigation.ts";
import {
  discover_workspace_roots,
  workspace_definition_location,
  workspace_reference_locations,
  workspace_rename_symbol,
  WorkspaceModel,
} from "./workspace.ts";

Deno.test("workspace discovers marker roots, imports, and overlay precedence", async () => {
  const root_path = await Deno.makeTempDir({ prefix: "duck-workspace-" });

  try {
    await Deno.writeTextFile(root_path + "/AGENTS.md", "workspace\n");
    await Deno.mkdir(root_path + "/src", { recursive: true });
    await Deno.writeTextFile(
      root_path + "/src/a.duck",
      "let exported = 1;\nexported\n",
    );
    await Deno.writeTextFile(
      root_path + "/src/b.duck",
      'const a = import "./a.duck";\nlet value = a.exported;\n',
    );
    await Deno.writeTextFile(
      root_path + "/src/c.duck",
      'const b = import "./b.duck";\nlet value = b.value;\n',
    );
    await Deno.writeTextFile(
      root_path + "/src/d.duck",
      'const c = import "./c.duck";\nlet value = c.value;\n',
    );
    await Deno.writeTextFile(
      root_path + "/src/unrelated.duck",
      "let separate = 9;\n",
    );
    const root_uri = directory_uri(root_path);
    const nested_uri = directory_uri(root_path + "/src");
    assert_equals(discover_workspace_roots([nested_uri]), [root_uri]);

    const model = new WorkspaceModel([nested_uri]);
    const progress: Array<[number, number]> = [];
    model.load([], (event) => progress.push([event.loaded, event.total]));
    assert_equals(model.file_count(), 5);
    assert_equals(model.analysis_count(), 0);
    assert_equals(model.dependency_count(), 3);
    assert_equals(progress.at(-1), [5, 5]);

    const a_uri = file_uri(root_path + "/src/a.duck");
    const b_uri = file_uri(root_path + "/src/b.duck");
    const c_uri = file_uri(root_path + "/src/c.duck");
    const d_uri = file_uri(root_path + "/src/d.duck");
    const unrelated_uri = file_uri(root_path + "/src/unrelated.duck");
    assert_equals(
      model.symbols([], "separate", "utf-16").map((symbol) =>
        symbol.location.uri
      ),
      [unrelated_uri],
    );
    assert_equals(model.analysis_count(), 0);
    assert_equals(model.affected_dependents(a_uri, 8, 8), [
      b_uri,
      c_uri,
      d_uri,
    ]);
    assert_equals(model.affected_dependents(a_uri, 1, 8), [b_uri]);
    assert_equals(model.affected_dependents(a_uri, 8, 1), [b_uri]);
    assert_equals(
      model.entries_for_uri(b_uri, [{
        uri: unrelated_uri,
        version: 2,
        text: "let separate = 10;\n",
      }]).map((entry) => entry.uri),
      [a_uri, b_uri, c_uri],
    );
    assert_equals(model.analysis_count(), 3);

    const overlay: TextDocument = {
      uri: b_uri,
      version: 2,
      text: 'const a = import "./a.duck";\nlet value = a.exported + 1;\n',
    };
    assert_equals(model.text(b_uri, [overlay]), overlay.text);
    const entries = model.entries([overlay]);
    assert_equals(
      entries.find((entry) => entry.uri === b_uri)?.text,
      overlay.text,
    );
    assert_equals(model.analysis_count(), 5);
  } finally {
    await Deno.remove(root_path, { recursive: true });
  }
});

Deno.test("workspace symbols use declaration metadata without semantic analysis", async () => {
  const root_path = await Deno.makeTempDir({ prefix: "duck-symbols-" });

  try {
    await Deno.writeTextFile(root_path + "/AGENTS.md", "workspace\n");
    await Deno.writeTextFile(
      root_path + "/symbols.duck",
      [
        "module (!init: Init) where",
        "type Pair value = struct { .left = value, .right = value }",
        "type Choice = | `Some Pair | `None Unit",
        "const choose = value => value;",
        "let selected = `Some ();",
        "if let `Some local = selected { local }",
        "",
      ].join("\n"),
    );
    const model = new WorkspaceModel([directory_uri(root_path)]);
    model.load([]);

    assert_equals(
      model.symbols([], "lft", "utf-16").map((symbol) => ({
        name: symbol.name,
        containerName: symbol.containerName,
      })),
      [{ name: "left", containerName: "Pair" }],
    );
    assert_equals(
      model.symbols([], "value", "utf-16"),
      [],
    );
    assert_equals(model.symbols([], "local", "utf-16"), []);
    assert_equals(
      model.symbols([], "some", "utf-16").map((symbol) => symbol.name),
      ["Some"],
    );
    assert_equals(
      model.symbols([], "choose", "utf-16").map((symbol) => symbol.kind),
      [14],
    );
    assert_equals(model.analysis_count(), 0);
    assert_equals(
      model.symbols([], "", "utf-16"),
      workspace_symbols(model.entries([]), "", "utf-16"),
    );
  } finally {
    await Deno.remove(root_path, { recursive: true });
  }
});

Deno.test("workspace navigation follows and renames imported members", async () => {
  const root_path = await Deno.makeTempDir({ prefix: "duck-navigation-" });

  try {
    await Deno.writeTextFile(root_path + "/AGENTS.md", "workspace\n");
    const a_text = "let exported = 1;\nexported\n";
    const b_text = 'const a = import "./a.duck";\nlet value = a.exported;\n';
    await Deno.writeTextFile(root_path + "/a.duck", a_text);
    await Deno.writeTextFile(root_path + "/b.duck", b_text);
    const a_uri = file_uri(root_path + "/a.duck");
    const b_uri = file_uri(root_path + "/b.duck");
    const model = new WorkspaceModel([directory_uri(root_path)]);
    model.load([]);
    const entries = model.entries([]);
    const member_offset = b_text.lastIndexOf("exported");
    assert_equals(
      workspace_definition_location(
        entries,
        b_uri,
        member_offset,
        "utf-16",
      ),
      {
        uri: a_uri,
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 12 },
        },
      },
    );
    assert_equals(
      workspace_reference_locations(
        entries,
        b_uri,
        member_offset,
        true,
        "utf-16",
      ),
      [{
        uri: a_uri,
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 12 },
        },
      }, {
        uri: a_uri,
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 8 },
        },
      }, {
        uri: b_uri,
        range: {
          start: { line: 1, character: 14 },
          end: { line: 1, character: 22 },
        },
      }],
    );

    const rename = workspace_rename_symbol(
      entries,
      b_uri,
      member_offset,
      "renamed",
      "utf-16",
    );
    assert_equals(rename, {
      changes: {
        [a_uri]: [{
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 12 },
          },
          newText: "renamed",
        }, {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 8 },
          },
          newText: "renamed",
        }],
        [b_uri]: [{
          range: {
            start: { line: 1, character: 14 },
            end: { line: 1, character: 22 },
          },
          newText: "renamed",
        }],
      },
    });
  } finally {
    await Deno.remove(root_path, { recursive: true });
  }
});

function directory_uri(path: string): string {
  const uri = new URL("file://" + path + "/");
  return uri.href;
}

function file_uri(path: string): string {
  return new URL("file://" + path).href;
}
