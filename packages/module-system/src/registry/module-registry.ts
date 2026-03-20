import { ModuleManifest, ModuleManifestSchema, ModuleRegistryEntry, isCompatibleVersion } from '../manifest/schema.js';
import type { ModuleStatusType } from '../manifest/schema.js';

export interface ModuleRegistryOptions {
  core_version?: string;
}

export class ModuleRegistry {
  private modules: Map<string, ModuleRegistryEntry> = new Map();
  private core_version: string;

  constructor(options?: ModuleRegistryOptions) {
    this.core_version = options?.core_version ?? '0.1.0';
  }

  register(manifest: ModuleManifest): ModuleRegistryEntry {
    const validated = ModuleManifestSchema.parse(manifest);

    if (this.modules.has(validated.module_id)) {
      throw new Error(`Module ${validated.module_id} is already registered. Unregister first.`);
    }

    const now = new Date().toISOString();
    const entry: ModuleRegistryEntry = {
      manifest: { ...validated, status: validated.status ?? 'registered' },
      enabled: false,
      registered_at: now,
      updated_at: now,
    };

    this.modules.set(validated.module_id, entry);
    return entry;
  }

  unregister(module_id: string): void {
    const entry = this.getEntry(module_id);
    if (entry.enabled) {
      throw new Error(`Cannot unregister enabled module ${module_id}. Disable it first.`);
    }
    this.modules.delete(module_id);
  }

  enable(module_id: string): ModuleRegistryEntry {
    const entry = this.getEntry(module_id);

    if (entry.manifest.policy_mode === 'blocked') {
      throw new Error(`Cannot enable module ${module_id}: source policy is BLOCKED.`);
    }

    if (entry.manifest.status === 'deprecated') {
      throw new Error(`Cannot enable deprecated module ${module_id}.`);
    }

    for (const dep of entry.manifest.dependencies) {
      const depEntry = this.modules.get(dep);
      if (!depEntry) {
        throw new Error(`Cannot enable ${module_id}: dependency ${dep} is not registered.`);
      }
      if (!depEntry.enabled) {
        throw new Error(`Cannot enable ${module_id}: dependency ${dep} is not enabled.`);
      }
    }

    const updated: ModuleRegistryEntry = {
      ...entry,
      enabled: true,
      manifest: { ...entry.manifest, status: 'enabled' },
      updated_at: new Date().toISOString(),
    };
    this.modules.set(module_id, updated);
    return updated;
  }

  disable(module_id: string): ModuleRegistryEntry {
    const entry = this.getEntry(module_id);

    const dependents = this.findDependents(module_id);
    const enabledDependents = dependents.filter((d) => d.enabled);
    if (enabledDependents.length > 0) {
      const ids = enabledDependents.map((d) => d.manifest.module_id).join(', ');
      throw new Error(`Cannot disable ${module_id}: enabled dependents: ${ids}`);
    }

    const updated: ModuleRegistryEntry = {
      ...entry,
      enabled: false,
      manifest: { ...entry.manifest, status: 'disabled' },
      updated_at: new Date().toISOString(),
    };
    this.modules.set(module_id, updated);
    return updated;
  }

  get(module_id: string): ModuleRegistryEntry {
    return this.getEntry(module_id);
  }

  list(filter?: { plugin_type?: string; status?: ModuleStatusType; enabled?: boolean }): ModuleRegistryEntry[] {
    let entries = Array.from(this.modules.values());
    if (filter?.plugin_type) {
      entries = entries.filter((e) => e.manifest.plugin_type === filter.plugin_type);
    }
    if (filter?.status) {
      entries = entries.filter((e) => e.manifest.status === filter.status);
    }
    if (filter?.enabled !== undefined) {
      entries = entries.filter((e) => e.enabled === filter.enabled);
    }
    return entries;
  }

  checkCompatibility(module_id: string): { compatible: boolean; issues: string[] } {
    const entry = this.getEntry(module_id);
    const issues: string[] = [];

    if (!isCompatibleVersion(this.core_version, entry.manifest.version)) {
      issues.push(`Module version ${entry.manifest.version} may not be compatible with core ${this.core_version}`);
    }

    for (const dep of entry.manifest.dependencies) {
      if (!this.modules.has(dep)) {
        issues.push(`Missing dependency: ${dep}`);
      }
    }

    return { compatible: issues.length === 0, issues };
  }

  size(): number {
    return this.modules.size;
  }

  clear(): void {
    this.modules.clear();
  }

  private getEntry(module_id: string): ModuleRegistryEntry {
    const entry = this.modules.get(module_id);
    if (!entry) {
      throw new Error(`Module ${module_id} is not registered.`);
    }
    return entry;
  }

  private findDependents(module_id: string): ModuleRegistryEntry[] {
    return Array.from(this.modules.values()).filter((e) =>
      e.manifest.dependencies.includes(module_id),
    );
  }
}
