import { diagnostic_codes } from "../diagnostic.ts";
import type { Source } from "./ast.ts";
import { validate_atom_identities } from "./atom.ts";
import { expand_source_attributes } from "./attribute.ts";
import { infer_default_effect_handlers } from "./default_handler.ts";
import { erase_undemanded_front_bindings } from "./demand.ts";
import { elaborate_front_ducks } from "./duck_elaborate.ts";
import { elaborate_front_effects } from "./effect_elaborate.ts";
import { specialize_front_effects } from "./effect_specialize.ts";
import {
  source_with_import_meta,
  type SourceImportMeta,
} from "./import_meta.ts";
import { elaborate_front_let_else } from "./let_else.ts";
import { validate_source_linear } from "./linear.ts";
import { resolve_bundled_source_imports } from "./load.ts";
import { specialize_const_module_imports } from "./module_specialize.ts";
import { validate_frontend_semantics } from "./semantic_validation.ts";
import { SourceDiagnosticError } from "./semantic_diagnostic.ts";
import {
  apply_front_function_signatures,
  infer_front_function_signatures,
} from "./signature_inference.ts";
import { source_facts, source_inference_diagnostics } from "./source_facts.ts";
import { derive_missing_source_spans } from "./syntax.ts";
import { elaborate_front_type_sets } from "./type_set_elaborate.ts";

export function source_for_core_route(source: Source): Source {
  source = source_with_expanded_attributes(source);
  return expanded_source_for_core_route(source);
}

export function expanded_source_for_core_route(source: Source): Source {
  derive_missing_source_spans(source, { start: 0, end: 0 });
  source = specialize_front_effects(source);
  source = infer_default_effect_handlers(source);
  require_rank_n_types(source);
  require_core_representation(source);
  source = erase_undemanded_front_bindings(elaborate_source(source));
  validate_atom_identities(source);
  validate_source_linear(source);
  return source;
}

export function source_with_expanded_attributes(
  source: Source,
  import_meta: SourceImportMeta = {},
): Source {
  source = source_with_import_meta(source, import_meta);
  const imported_source = resolve_bundled_source_imports(source);
  const inferred_source = infer_front_function_signatures(imported_source);
  const contextual_source = apply_front_function_signatures(
    source,
    inferred_source,
  );

  if (contextual_source === source) {
    source = inferred_source;
  } else {
    source = resolve_bundled_source_imports(contextual_source);
    source = infer_front_function_signatures(source);
  }

  source = specialize_const_module_imports(source);
  derive_missing_source_spans(source, { start: 0, end: 0 });
  return expand_source_attributes(source);
}

function elaborate_source(source: Source): Source {
  source = elaborate_front_let_else(source);
  source = infer_front_function_signatures(source);
  const inferred_source = source;
  source = elaborate_front_ducks(source);

  if (source !== inferred_source) {
    source = infer_front_function_signatures(source);
  }

  source = elaborate_front_effects(source);
  return elaborate_front_type_sets(source);
}

function require_rank_n_types(source: Source): void {
  const diagnostics = source_inference_diagnostics(
    source,
    source_facts(source),
  );

  for (const diagnostic of diagnostics) {
    if (
      diagnostic.severity === "error" &&
      diagnostic.code === diagnostic_codes.rank_n_type_mismatch
    ) {
      throw new SourceDiagnosticError(diagnostic);
    }
  }
}

function require_core_representation(source: Source): void {
  const diagnostics = validate_frontend_semantics(source, {
    scope: "core-representation",
  });

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      throw new SourceDiagnosticError(diagnostic);
    }
  }
}
