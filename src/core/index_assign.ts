export {
  emit_core_runtime_aggregate_index_assign,
  plan_core_runtime_aggregate_index_assign,
} from "./index_assign/runtime_aggregate.ts";
export {
  emit_core_static_index_assign,
  plan_core_static_index_assign,
} from "./index_assign/static.ts";
export type {
  CoreIndexAssignCtx,
  CoreIndexAssignHooks,
  CoreIndexAssignStmt,
  CoreIndexAssignValuePlan,
  RuntimeAggregateIndexAssignPlan,
  StaticIndexAssignPlan,
} from "./index_assign/types.ts";
