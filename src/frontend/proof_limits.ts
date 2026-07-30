export const proof_limits = Object.freeze({
  maximum_formula_disjuncts: 16,
  maximum_exclusions_per_value: 16,
  maximum_congruences_per_value: 8,
  maximum_relational_terms_per_function: 64,
  loop_growth_iterations_before_widen: 3,
  function_summary_iterations: 8,
  compiler_search_steps: 10_000,
  compiler_search_depth: 16,
  editor_search_steps: 2_000,
  editor_search_depth: 8,
});
