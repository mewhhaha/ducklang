import { assert_equals } from "../assert.ts";
import { Source } from "../frontend.ts";
import { analysis_diagnostics, parse_diagnostics } from "./diagnostics.ts";

Deno.test("parse diagnostics use Baba recovery offsets", () => {
  const diagnostics = parse_diagnostics("let = 1;\n");

  assert_equals(diagnostics, [{
    range: {
      start: { line: 0, character: 4 },
      end: { line: 0, character: 4 },
    },
    severity: 1,
    source: "duck",
    message: "Baba parser rejected MISSING",
  }]);
});

Deno.test("Baba parse diagnostics report one UTF-16 Unicode range", () => {
  const diagnostics = parse_diagnostics("😀\nlet value = 1;\n");

  assert_equals(diagnostics, [{
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 2 },
    },
    severity: 1,
    source: "duck",
    message: "Baba parser rejected ERROR",
  }]);
});

Deno.test("semantic warnings retain code and map to LSP warning severity", () => {
  const text = "let value = 1;\n";
  const parsed = Source.parse_with_diagnostics(text);
  const diagnostics = analysis_diagnostics(
    {
      source: parsed.source,
      syntax: parsed.syntax,
      syntax_diagnostics: [],
      diagnostics: [{
        code: "DUCK2003",
        severity: "warning",
        message: "Unused runtime binding value",
        span: { start: 0, end: 13 },
      }],
    },
    "file:///warning.duck",
    "utf-16",
  );

  assert_equals(diagnostics, [{
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 13 },
    },
    severity: 2,
    source: "duck",
    code: "DUCK2003",
    message: "Unused runtime binding value",
  }]);
});

Deno.test("LSP warns when user source calls a raw prelude intrinsic", () => {
  const uri = "file:///raw-intrinsic.duck";
  const diagnostics = analysis_diagnostics(
    Source.analyze('@slice("duck", 0, 2)', { uri, warnings: true }),
    uri,
    "utf-16",
  );
  const warning = diagnostics.find((diagnostic) => {
    return diagnostic.code === "DUCK2004";
  });

  if (warning === undefined) {
    throw new Error("Missing raw intrinsic warning");
  }

  assert_equals(warning, {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 6 },
    },
    severity: 2,
    source: "duck",
    code: "DUCK2004",
    message:
      "Raw intrinsic @slice is reserved for prelude and compiler-facing source",
  });
});

Deno.test("semantic diagnostics carry same-document related information", () => {
  const uri = "file:///linear.duck";
  const diagnostics = analysis_diagnostics(
    Source.analyze("let !token = 41;\n!token + !token\n", { uri }),
    uri,
    "utf-16",
  );
  const diagnostic = diagnostics[0];

  if (diagnostic === undefined) {
    throw new Error("Missing linear diagnostic");
  }

  assert_equals(diagnostic.code, "DUCK2201");
  assert_equals(diagnostic.range, {
    start: { line: 1, character: 9 },
    end: { line: 1, character: 15 },
  });
  assert_equals(diagnostic.relatedInformation, [{
    location: {
      uri,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 6 },
      },
    },
    message: "First consumed here",
  }, {
    location: {
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 16 },
      },
    },
    message: "Linear value declared here",
  }]);
});

Deno.test("LSP preserves the compiler diagnostic sequence and identities", () => {
  const text = "let unused = 1;\nlet !token = 2;\n!token + !token\n";
  const analysis = Source.analyze(text, { warnings: true });
  const diagnostics = analysis_diagnostics(
    analysis,
    "file:///sequence.duck",
    "utf-16",
  );

  assert_equals(
    diagnostics.map((diagnostic) => {
      let severity = "error";

      if (diagnostic.severity === 2) {
        severity = "warning";
      }

      return {
        code: diagnostic.code,
        severity,
        message: diagnostic.message,
      };
    }),
    analysis.diagnostics.map((diagnostic) => {
      return {
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
      };
    }),
  );
});

Deno.test("LSP anchors closed dependency syntax errors at their import", () => {
  const uri = "file:///main.duck";
  const source = 'const dependency = import "./dep.duck";\ndependency\n';
  const analysis = Source.analyze(source, {
    uri,
    resolve_import: (dependency_uri) => {
      if (dependency_uri === "file:///dep.duck") {
        return "module () where\nlet value = ;\nreturn {};\n";
      }
      return undefined;
    },
  });

  assert_equals(analysis_diagnostics(analysis, uri, "utf-16"), [{
    range: {
      start: { line: 0, character: 19 },
      end: { line: 0, character: 38 },
    },
    severity: 1,
    source: "duck",
    code: "DUCK1001",
    message: "Imported source file:///dep.duck: Baba parser rejected MISSING",
  }]);
});
