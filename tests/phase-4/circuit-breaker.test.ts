import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../packages/connectors/src/base/circuit-breaker.js';

describe('Circuit Breaker — State transitions', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('stays closed below failure threshold', () => {
    const cb = new CircuitBreaker({ failure_threshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    const cb = new CircuitBreaker({ failure_threshold: 3 });
    for (let i = 0; i < 3; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to half_open after recovery timeout', () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, recovery_timeout_ms: 1 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    // Wait just enough for the 1ms timeout
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(cb.getState()).toBe('half_open');
    expect(cb.canExecute()).toBe(true);
  });

  it('closes again on success in half_open', () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, recovery_timeout_ms: 1 });
    cb.recordFailure();
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    cb.getState(); // triggers half_open
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('reopens on failure in half_open', () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, recovery_timeout_ms: 1, half_open_max_attempts: 1 });
    cb.recordFailure();
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    cb.getState(); // triggers half_open
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('reset returns to closed state', () => {
    const cb = new CircuitBreaker({ failure_threshold: 1 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('success resets failure count in closed state', () => {
    const cb = new CircuitBreaker({ failure_threshold: 5 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
  });
});

describe('Circuit Breaker — Connector integration', () => {
  it('connector returns error when circuit is open', async () => {
    const { EvmOnchainConnector } = await import('../../packages/connectors/src/adapters/evm-onchain.js');
    const connector = new EvmOnchainConnector({
      source_id: 'onchain_evm',
      endpoint: 'https://test',
      policy_mode: 'allow',
      circuit_breaker: { failure_threshold: 1 },
    });

    // Force circuit open via internal access
    (connector as any).circuitBreaker.recordFailure();
    const result = await connector.fetch({ limit: 10 });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Circuit breaker OPEN');
  });
});
