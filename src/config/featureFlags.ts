// Centralized feature flags. Mutate here, not at call sites.
// SIGNAL_QUEUE_VISIBLE: hides the Signal Queue UI while preserving the
// data model + routes for the user's dormant social-pipeline plan.
export const FEATURE_FLAGS = {
  SIGNAL_QUEUE_VISIBLE: false,
  SUGGESTED_GOALS_ENABLED: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
