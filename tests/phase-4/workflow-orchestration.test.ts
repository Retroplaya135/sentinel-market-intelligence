import { describe, it, expect } from 'vitest';
import { WorkflowOrchestrator } from '../../packages/app-layer/src/orchestration/workflow.js';
import { getServiceDependencyOrder, SERVICE_BOUNDARIES, getServiceBoundary } from '../../packages/app-layer/src/boundaries/services.js';

describe('Service Boundaries', () => {
  it('defines exactly 7 services', () => {
    expect(SERVICE_BOUNDARIES.length).toBe(7);
  });

  it('dependency order is deterministic', () => {
    const order = getServiceDependencyOrder();
    expect(order).toEqual(['ingestion', 'normalization', 'scoring', 'fusion', 'alerting', 'explain', 'replay']);
  });

  it('each service has inputs, outputs, description', () => {
    for (const b of SERVICE_BOUNDARIES) {
      expect(b.inputs.length).toBeGreaterThan(0);
      expect(b.outputs.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
    }
  });

  it('getServiceBoundary returns correct service', () => {
    const b = getServiceBoundary('scoring');
    expect(b?.name).toBe('scoring');
    expect(b?.dependencies).toContain('normalization');
  });

  it('ingestion has source_policy check', () => {
    const b = getServiceBoundary('ingestion');
    expect(b?.policy_checks).toContain('source_policy');
  });
});

describe('Workflow Orchestration — Deterministic pipeline', () => {
  it('executes full pipeline with all handlers', async () => {
    const orchestrator = new WorkflowOrchestrator();

    for (const svc of getServiceDependencyOrder()) {
      orchestrator.registerHandler(svc, async (ctx) => ({
        success: true,
        output: { from: ctx.service, data: ctx.input },
        output_count: 1,
      }));
    }

    const exec = await orchestrator.execute('BTC', { raw: 'initial' });
    expect(exec.status).toBe('completed');
    expect(exec.steps.filter((s) => s.status === 'completed').length).toBe(7);
    expect(exec.trace_id).toBeTruthy();
    expect(exec.execution_id).toBeTruthy();
    expect(exec.completed_at).toBeTruthy();
  });

  it('skips steps without handlers', async () => {
    const orchestrator = new WorkflowOrchestrator();
    orchestrator.registerHandler('ingestion', async () => ({ success: true, output: {}, output_count: 1 }));

    const exec = await orchestrator.execute('ETH', {});
    expect(exec.status).toBe('completed');
    expect(exec.steps[0].status).toBe('completed');
    expect(exec.steps[1].status).toBe('skipped');
  });

  it('stops pipeline on failure and marks remaining as skipped', async () => {
    const orchestrator = new WorkflowOrchestrator();
    orchestrator.registerHandler('ingestion', async () => ({ success: true, output: {}, output_count: 1 }));
    orchestrator.registerHandler('normalization', async () => ({ success: false, output: null, output_count: 0, error: 'Schema mismatch' }));
    orchestrator.registerHandler('scoring', async () => ({ success: true, output: {}, output_count: 1 }));

    const exec = await orchestrator.execute('SOL', {});
    expect(exec.status).toBe('failed');
    expect(exec.steps[0].status).toBe('completed');
    expect(exec.steps[1].status).toBe('failed');
    expect(exec.steps[1].error).toBe('Schema mismatch');
    expect(exec.steps[2].status).toBe('skipped');
  });

  it('handles thrown errors in handlers', async () => {
    const orchestrator = new WorkflowOrchestrator();
    orchestrator.registerHandler('ingestion', async () => { throw new Error('Connection timeout'); });

    const exec = await orchestrator.execute('DOGE', {});
    expect(exec.status).toBe('failed');
    expect(exec.steps[0].status).toBe('failed');
    expect(exec.steps[0].error).toBe('Connection timeout');
  });

  it('passes output of previous step as input to next step', async () => {
    const orchestrator = new WorkflowOrchestrator();
    const inputs: unknown[] = [];

    orchestrator.registerHandler('ingestion', async (ctx) => {
      inputs.push(ctx.input);
      return { success: true, output: { step: 'ingestion_done' }, output_count: 1 };
    });
    orchestrator.registerHandler('normalization', async (ctx) => {
      inputs.push(ctx.input);
      return { success: true, output: { step: 'normalization_done' }, output_count: 1 };
    });

    await orchestrator.execute('BTC', { raw: true });
    expect(inputs[0]).toEqual({ raw: true });
    expect(inputs[1]).toEqual({ step: 'ingestion_done' });
  });

  it('each step records duration_ms', async () => {
    const orchestrator = new WorkflowOrchestrator();
    orchestrator.registerHandler('ingestion', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { success: true, output: {}, output_count: 1 };
    });

    const exec = await orchestrator.execute('BTC', {});
    expect(exec.steps[0].duration_ms).toBeGreaterThanOrEqual(0);
  });
});
