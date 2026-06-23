// Pure helpers for projecting Kubernetes resources into the compact shape sent
// to the model. Kept free of host/MobX dependencies so they can be unit-tested
// directly (see project-resource.test.ts).

/**
 * Strip the noisy `metadata.managedFields` block from a resource's metadata.
 * The server-side apply bookkeeping is large and irrelevant for LLM analysis,
 * so it is removed by default; callers can opt back in via `includeManagedFields`
 * when the field is actually needed. The original object is never mutated.
 */
export function stripManagedFields<T extends object>(
  metadata: T | undefined,
  includeManagedFields = false,
): T | undefined {
  if (includeManagedFields || !metadata || !("managedFields" in metadata)) {
    return metadata;
  }
  const { managedFields: _managedFields, ...rest } = metadata as T & { managedFields?: unknown };
  return rest as T;
}
