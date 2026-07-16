import { assert_equals } from "../assert.ts";
import { document_binding_index } from "./binding_index.ts";
import { DocumentStore } from "./documents.ts";

Deno.test("binding index rebuilds only the edited document version", () => {
  const documents = new DocumentStore();
  const first = "file:///first.duck";
  const second = "file:///second.duck";
  documents.open(first, 1, "let first = 1\nfirst\n");
  documents.open(second, 4, "let second = 2\nsecond\n");

  assert_equals(document_binding_index(documents, first).version, 1);
  assert_equals(document_binding_index(documents, second).version, 4);
  assert_equals(document_binding_index(documents, first).version, 1);

  documents.apply_changes(first, 2, [{ text: "let first = 3\nfirst\n" }]);

  assert_equals(document_binding_index(documents, first).version, 2);
  assert_equals(document_binding_index(documents, second).version, 4);
  assert_equals(documents.compute_count(first, "binding_index"), 2);
  assert_equals(documents.compute_count(second, "binding_index"), 1);
});
