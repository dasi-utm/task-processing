/**
 * Feature flags for task-processing.
 *
 * Read once at startup from environment variables.
 */

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

export const featureFlags = {
  /**
   * FEATURE_RANDOMIZATION_ENABLED (default: true)
   *
   * true  — Random task type, random priority, slow-path multiplier active.
   * false — Fixed type='data-processing', priority='Medium', no slow path.
   *         Reverts to the original deterministic simulator behaviour.
   */
  randomization: readBoolEnv('FEATURE_RANDOMIZATION_ENABLED', true),
} as const;

// Log effective flag values at startup so they appear in container logs.
console.log(
  `[FeatureFlags] FEATURE_RANDOMIZATION_ENABLED=${featureFlags.randomization}`,
);
