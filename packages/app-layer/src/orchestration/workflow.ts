import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ServiceNameType } from '../boundaries/services.js';
import { getServiceDependencyOrder } from '../boundaries/services.js';

export const WorkflowStepStatus = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);
export type WorkflowStepStatusType = z.infer<typeof WorkflowStepStatus>;

export interface WorkflowStep {
  service: ServiceNameType;
  status: WorkflowStepStatusType;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
  output_count?: number;
}

export interface WorkflowExecution {
  execution_id: string;
  trace_id: string;
  asset_id: string;
  steps: WorkflowStep[];
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

export interface StepContext {
  execution_id: string;
  trace_id: string;
  asset_id: string;
  service: ServiceNameType;
  input: unknown;
}

export interface StepResult {
  success: boolean;
  output: unknown;
  output_count: number;
  error?: string;
}

export class WorkflowOrchestrator {
  private handlers: Map<ServiceNameType, StepHandler> = new Map();

  registerHandler(service: ServiceNameType, handler: StepHandler): void {
    this.handlers.set(service, handler);
  }

  async execute(asset_id: string, initial_input: unknown): Promise<WorkflowExecution> {
    const execution_id = `exec_${randomUUID()}`;
    const trace_id = `trace_${randomUUID()}`;
    const order = getServiceDependencyOrder();

    const execution: WorkflowExecution = {
      execution_id,
      trace_id,
      asset_id,
      steps: order.map((s) => ({ service: s, status: 'pending' as WorkflowStepStatusType })),
      status: 'running',
      started_at: new Date().toISOString(),
    };

    let currentInput = initial_input;

    for (let i = 0; i < order.length; i++) {
      const service = order[i];
      const handler = this.handlers.get(service);
      const step = execution.steps[i];

      if (!handler) {
        step.status = 'skipped';
        continue;
      }

      step.status = 'running';
      step.started_at = new Date().toISOString();

      try {
        const result = await handler({
          execution_id, trace_id, asset_id, service, input: currentInput,
        });

        step.completed_at = new Date().toISOString();
        step.duration_ms = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
        step.output_count = result.output_count;

        if (result.success) {
          step.status = 'completed';
          currentInput = result.output;
        } else {
          step.status = 'failed';
          step.error = result.error;
          execution.status = 'failed';
          execution.completed_at = new Date().toISOString();
          for (let j = i + 1; j < execution.steps.length; j++) {
            execution.steps[j].status = 'skipped';
          }
          return execution;
        }
      } catch (err) {
        step.status = 'failed';
        step.error = err instanceof Error ? err.message : String(err);
        step.completed_at = new Date().toISOString();
        step.duration_ms = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
        execution.status = 'failed';
        execution.completed_at = new Date().toISOString();
        for (let j = i + 1; j < execution.steps.length; j++) {
          execution.steps[j].status = 'skipped';
        }
        return execution;
      }
    }

    execution.status = 'completed';
    execution.completed_at = new Date().toISOString();
    return execution;
  }
}
