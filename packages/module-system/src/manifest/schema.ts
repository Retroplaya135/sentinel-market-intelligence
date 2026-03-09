import { z } from 'zod';

export const ModuleStatus = z.enum(['registered', 'enabled', 'disabled', 'error', 'deprecated']);
export type ModuleStatusType = z.infer<typeof ModuleStatus>;

export const PluginType = z.enum(['connector', 'scorer', 'explainer', 'alert_strategy']);
export type PluginTypeType = z.infer<typeof PluginType>;

export const PolicyModeRef = z.enum(['allow', 'conditional', 'blocked']);

export const ModuleManifestSchema = z.object({
  module_id: z.string().min(1).regex(/^[a-z][a-z0-9_.]*$/, 'module_id must be lowercase alphanumeric with dots/underscores'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver (x.y.z)'),
  name: z.string().min(1),
  description: z.string().min(1),
  plugin_type: PluginType,
  capabilities: z.array(z.string().min(1)).min(1),
  inputs: z.array(z.string().min(1)),
  outputs: z.array(z.string().min(1)),
  policy_mode: PolicyModeRef,
  status: ModuleStatus.default('registered'),
  dependencies: z.array(z.string()).default([]),
  config_schema: z.record(z.string(), z.unknown()).optional(),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export const ModuleRegistryEntrySchema = z.object({
  manifest: ModuleManifestSchema,
  enabled: z.boolean().default(false),
  registered_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ModuleRegistryEntry = z.infer<typeof ModuleRegistryEntrySchema>;

export function isCompatibleVersion(required: string, actual: string): boolean {
  const [reqMajor] = required.split('.').map(Number);
  const [actMajor] = actual.split('.').map(Number);
  return reqMajor === actMajor;
}
