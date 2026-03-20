import { z } from 'zod';
import { randomUUID } from 'crypto';

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevelType = z.infer<typeof LogLevel>;

const LEVEL_PRIORITY: Record<LogLevelType, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

export const StructuredLogEntrySchema = z.object({
  log_id: z.string().min(1),
  timestamp: z.string().datetime(),
  level: LogLevel,
  service: z.string().min(1),
  message: z.string().min(1),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  tenant_id: z.string().optional(),
  actor_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  error: z.object({ code: z.string(), message: z.string(), stack: z.string().optional() }).optional(),
  duration_ms: z.number().nonnegative().optional(),
});
export type StructuredLogEntry = z.infer<typeof StructuredLogEntrySchema>;

export class StructuredLogger {
  private entries: StructuredLogEntry[] = [];
  private service: string;
  private minLevel: LogLevelType;
  private activeTraceId: string | undefined;

  constructor(service: string, minLevel: LogLevelType = 'debug') {
    this.service = service;
    this.minLevel = minLevel;
  }

  startTrace(traceId?: string): string {
    this.activeTraceId = traceId ?? `trace_${randomUUID()}`;
    return this.activeTraceId;
  }

  endTrace(): void { this.activeTraceId = undefined; }
  getActiveTraceId(): string | undefined { return this.activeTraceId; }

  log(level: LogLevelType, message: string, opts: {
    trace_id?: string; span_id?: string; tenant_id?: string;
    actor_id?: string; metadata?: Record<string, unknown>;
    error?: { code: string; message: string; stack?: string };
    duration_ms?: number;
  } = {}): StructuredLogEntry | null {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return null;

    const entry: StructuredLogEntry = {
      log_id: `log_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      trace_id: opts.trace_id ?? this.activeTraceId,
      span_id: opts.span_id,
      tenant_id: opts.tenant_id,
      actor_id: opts.actor_id,
      metadata: opts.metadata ?? {},
      error: opts.error,
      duration_ms: opts.duration_ms,
    };

    StructuredLogEntrySchema.parse(entry);
    this.entries.push(entry);
    return entry;
  }

  debug(msg: string, opts?: Parameters<StructuredLogger['log']>[2]): StructuredLogEntry | null { return this.log('debug', msg, opts); }
  info(msg: string, opts?: Parameters<StructuredLogger['log']>[2]): StructuredLogEntry | null { return this.log('info', msg, opts); }
  warn(msg: string, opts?: Parameters<StructuredLogger['log']>[2]): StructuredLogEntry | null { return this.log('warn', msg, opts); }
  error(msg: string, opts?: Parameters<StructuredLogger['log']>[2]): StructuredLogEntry | null { return this.log('error', msg, opts); }
  fatal(msg: string, opts?: Parameters<StructuredLogger['log']>[2]): StructuredLogEntry | null { return this.log('fatal', msg, opts); }

  getEntries(): StructuredLogEntry[] { return [...this.entries]; }

  getByLevel(level: LogLevelType): StructuredLogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }

  getByTrace(traceId: string): StructuredLogEntry[] {
    return this.entries.filter((e) => e.trace_id === traceId);
  }

  getByService(service: string): StructuredLogEntry[] {
    return this.entries.filter((e) => e.service === service);
  }

  getByTenant(tenantId: string): StructuredLogEntry[] {
    return this.entries.filter((e) => e.tenant_id === tenantId);
  }

  search(keyword: string): StructuredLogEntry[] {
    const lower = keyword.toLowerCase();
    return this.entries.filter((e) =>
      e.message.toLowerCase().includes(lower) ||
      (e.error?.message ?? '').toLowerCase().includes(lower),
    );
  }

  size(): number { return this.entries.length; }
  clear(): void { this.entries = []; }
}
