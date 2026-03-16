export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failure_threshold: number;
  recovery_timeout_ms: number;
  half_open_max_attempts: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failure_threshold: 5,
  recovery_timeout_ms: 30000,
  half_open_max_attempts: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failure_count = 0;
  private last_failure_at = 0;
  private half_open_attempts = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.last_failure_at;
      if (elapsed >= this.options.recovery_timeout_ms) {
        this.state = 'half_open';
        this.half_open_attempts = 0;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const current = this.getState();
    if (current === 'closed') return true;
    if (current === 'half_open') return this.half_open_attempts < this.options.half_open_max_attempts;
    return false;
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.failure_count = 0;
      this.half_open_attempts = 0;
    }
    if (this.state === 'closed') {
      this.failure_count = 0;
    }
  }

  recordFailure(): void {
    this.failure_count++;
    this.last_failure_at = Date.now();

    if (this.state === 'half_open') {
      this.half_open_attempts++;
      if (this.half_open_attempts >= this.options.half_open_max_attempts) {
        this.state = 'open';
      }
    } else if (this.failure_count >= this.options.failure_threshold) {
      this.state = 'open';
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failure_count = 0;
    this.half_open_attempts = 0;
  }

  getFailureCount(): number {
    return this.failure_count;
  }
}
