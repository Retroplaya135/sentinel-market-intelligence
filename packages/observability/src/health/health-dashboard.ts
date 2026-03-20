import { z } from 'zod';

export const ComponentHealthStatus = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export type ComponentHealthStatusType = z.infer<typeof ComponentHealthStatus>;

export interface ComponentHealth {
  component_id: string;
  name: string;
  status: ComponentHealthStatusType;
  last_check_at: string;
  latency_ms?: number;
  error_message?: string;
  dependencies: string[];
  metadata: Record<string, unknown>;
}

export interface SystemHealth {
  status: ComponentHealthStatusType;
  checked_at: string;
  components: ComponentHealth[];
  summary: { total: number; healthy: number; degraded: number; unhealthy: number; unknown: number };
}

const STATUS_PRIORITY: Record<ComponentHealthStatusType, number> = { healthy: 0, degraded: 1, unhealthy: 2, unknown: 3 };

export class HealthDashboard {
  private components: Map<string, ComponentHealth> = new Map();

  registerComponent(params: {
    component_id: string; name: string; dependencies?: string[];
  }): ComponentHealth {
    const health: ComponentHealth = {
      component_id: params.component_id,
      name: params.name,
      status: 'unknown',
      last_check_at: new Date().toISOString(),
      dependencies: params.dependencies ?? [],
      metadata: {},
    };
    this.components.set(params.component_id, health);
    return health;
  }

  updateStatus(componentId: string, status: ComponentHealthStatusType, opts?: {
    latency_ms?: number; error_message?: string; metadata?: Record<string, unknown>;
  }): ComponentHealth {
    const comp = this.components.get(componentId);
    if (!comp) throw new Error(`Component ${componentId} not registered.`);

    comp.status = status;
    comp.last_check_at = new Date().toISOString();
    if (opts?.latency_ms !== undefined) comp.latency_ms = opts.latency_ms;
    if (opts?.error_message !== undefined) comp.error_message = opts.error_message;
    if (opts?.metadata) comp.metadata = { ...comp.metadata, ...opts.metadata };

    return comp;
  }

  getComponent(componentId: string): ComponentHealth | undefined {
    return this.components.get(componentId);
  }

  getSystemHealth(): SystemHealth {
    const comps = Array.from(this.components.values());
    const summary = { total: comps.length, healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 };

    for (const c of comps) {
      summary[c.status]++;
    }

    let worstStatus: ComponentHealthStatusType = 'healthy';
    for (const c of comps) {
      if (STATUS_PRIORITY[c.status] > STATUS_PRIORITY[worstStatus]) {
        worstStatus = c.status;
      }
    }

    if (comps.length === 0) worstStatus = 'unknown';

    return {
      status: worstStatus,
      checked_at: new Date().toISOString(),
      components: comps,
      summary,
    };
  }

  getByStatus(status: ComponentHealthStatusType): ComponentHealth[] {
    return Array.from(this.components.values()).filter((c) => c.status === status);
  }

  getDependencyHealth(componentId: string): { component_id: string; status: ComponentHealthStatusType }[] {
    const comp = this.components.get(componentId);
    if (!comp) return [];
    return comp.dependencies.map((depId) => {
      const dep = this.components.get(depId);
      return { component_id: depId, status: dep?.status ?? 'unknown' };
    });
  }

  checkDependencySatisfied(componentId: string): boolean {
    const deps = this.getDependencyHealth(componentId);
    return deps.every((d) => d.status === 'healthy' || d.status === 'degraded');
  }

  size(): number { return this.components.size; }
  clear(): void { this.components.clear(); }
}
