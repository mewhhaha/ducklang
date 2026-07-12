import { expect } from "../expect.ts";
import {
  type BindingIndex,
  build_binding_index,
} from "../frontend/binding_index.ts";
import { parse_source_with_diagnostics } from "../frontend/parser.ts";
import type { DocumentStore } from "./documents.ts";

export const binding_index_cache_key = "binding_index";

/** Return the binding index cached for the open document's current version. */
export function document_binding_index(
  documents: DocumentStore,
  uri: string,
): BindingIndex {
  const document = documents.get(uri);
  expect(document !== undefined, "cannot index a document that is not open");
  const parsed = documents.compute(
    uri,
    "source_parse",
    parse_source_with_diagnostics,
  );

  return documents.compute(
    uri,
    binding_index_cache_key,
    () => build_binding_index(parsed, document.version),
  );
}
