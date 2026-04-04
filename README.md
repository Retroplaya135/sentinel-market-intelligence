<div align="center">
  <img src="docs/cover.png" alt="Sentinel Market Intelligence" width="100%">
  <p><strong>Policy-first processing for traceable crypto-market evidence, scores, alerts, and replay.</strong></p>
  <p>
    <a href="#why-sentinel">Why</a> ·
    <a href="#processing-map">Processing map</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#verification">Verification</a> ·
    <a href="#project-boundaries">Boundaries</a>
  </p>
  <p>
    <img alt="Status: pre-1.0 reference implementation" src="https://img.shields.io/badge/status-pre--1.0_reference-64748b">
    <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/node-22%2B-339933">
    <img alt="TypeScript 5.7" src="https://img.shields.io/badge/typescript-5.7-3178C6">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-16a34a">
  </p>
</div>

Sentinel is a TypeScript reference implementation for turning crypto-market evidence into policy-checked, traceable scores and alerts. It concentrates on the parts of an intelligence pipeline that are easy to blur together: source eligibility, provenance, data quality, scoring, explanations, alert invalidation, retention, and deterministic replay.

The repository uses synthetic events and in-memory stores. It demonstrates contracts and failure behavior without collecting live data, placing trades, or claiming predictive performance.

## Why Sentinel

An analytics pipeline can produce a number long before it can explain whether the underlying data was allowed, current, complete, or still valid. Once an alert has been issued, corrections and policy changes create a second problem: derived outputs must be invalidated or replayed rather than treated as permanent truth.

Sentinel makes those obligations explicit. Source policy is evaluated before scoring. Evidence references travel with derived results. Conditional and blocked sources have executable gates. Retention decisions can produce deletion proofs. Alerts carry invalidation behavior. Recorded events can be replayed and compared with the original result.

The result is a repository for studying lifecycle integrity, not only the happy path from input to score.

## Processing map

| Stage | Responsibility | Output |
| --- | --- | --- |
| Contracts | Validate product position, source policy, retention, schemas, and shared vocabulary | Versioned runtime-safe contracts |
| Source gate | Allow, conditionally admit, or block a source before processing | Auditable policy decision |
| Connector boundary | Normalize source-specific input and attach provenance | Canonical source records |
| ETL and quality | Transform, validate, quarantine, and record lineage | Qualified evidence and lineage graph |
| Data layer | Hold events, snapshots, hot-path records, features, and TTL-aware cache entries | Reconstructable in-memory state |
| Scoring | Score each source, fuse signals, detect manipulation, and produce explanations | Evidence-linked score and explanation |
| Alerting | Apply thresholds, cooldowns, severity routing, and invalidation rules | Alert record or documented suppression |
| Observability | Carry trace context, structured logs, metrics, SLO calculations, and reliability scores | Operational evidence |
| Replay | Re-run ordered events, compare outcomes, and generate a hash-chain proof | Replay result and divergence report |

`SentinelPipeline` joins the main path for tests: policy check, score, manipulation check, fusion, explanation, alert evaluation, event append, and snapshot capture. Each stage records success, duration, trace context, and a typed platform error when it fails.

## Implemented capabilities

### Policy and contracts

- Machine-readable product, source-policy, and data-lifecycle contracts.
- Zod schemas for cross-package DTOs, errors, events, observability, entitlements, SLOs, and policy records.
- Hard guards for blocked source categories.
- Conditional-source gates that default to disabled and require explicit checks.
- Consent-scoped exceptions with expiry and approval fields.
- Training eligibility checks separated from inference eligibility.
- Retention-window evaluation and deletion-proof generation.
- Policy audit records for allow and deny decisions.

### Ingestion and data quality

- Connector base class, deduplication index, canonical hashing, and provenance tagging.
- Synthetic adapters representing on-chain, exchange, licensed-news, and first-party boundaries.
- Circuit breaker, quota state, and connector health telemetry.
- Transform jobs with versioned data contracts.
- Freshness, completeness, schema-drift, and volume-anomaly checks.
- In-memory quarantine and lineage tracking.
- Event, snapshot, hot-path, feature, and cache stores with explicit interfaces.

### Scoring and alerts

- Per-source sentiment scoring with model-version metadata.
- Weighted fusion across qualified source scores.
- Manipulation markers for coordination and account-quality signals.
- Evidence-linked explanation generation.
- Calibration reports for recorded outcomes.
- Threshold strategies, severity selection, cooldown deduplication, and dispatch routing.
- Alert invalidation for score drift, direction reversal, missing evidence, and expiry.

### Replay and operations

- Dependency-ordered workflow orchestration and policy middleware.
- Trace propagation across pipeline stages.
- Structured logs, metrics, SLO calculations, component health, and reliability scorecards.
- Ordered replay with range filtering and point-in-time reconstruction from snapshots.
- Original-versus-replay comparison for numeric and structural divergence.
- Audit proofs with a verifiable hash chain over replay results.

## Quick start

Sentinel requires Node.js 22 or newer. The lockfile is committed for repeatable local installation.

```bash
npm ci
npm run gate:full
npm run build
```

Start with the contracts and the phase-six tests. The contracts describe what the system is allowed to claim and process; the end-to-end tests show how that policy reaches scoring, alerts, snapshots, and replay.

`npm run build` compiles the TypeScript project references. The workspace packages expose source entry points for development and are not presented here as separately published registry packages.

## Practical usage

Sentinel is organized for selective study. A team working on compliant source ingestion can use the policy engine, contracts, and connector interfaces without adopting the scoring model. A team focused on reproducibility can use the event store, snapshot store, replay engine, and audit proofs. The integration package exists to show how the boundaries compose.

The policy model has three modes:

| Mode | Default | Intended behavior |
| --- | --- | --- |
| Allow | Enabled | Process only under the documented source and retention terms |
| Conditional | Disabled | Require a commercial/legal gate, explicit activation state, and cost or quota controls |
| Blocked | Disabled | Reject through an executable guard unless a narrowly scoped, approved exception is valid |

The included source policies are examples of enforceable system design, not current legal advice. Before using a real source, verify its present contract, API terms, permitted model usage, retention duties, and redistribution limits.

Scoring is deterministic over its supplied records and configuration. That makes it suitable for contract and replay tests, but it does not make a score predictive. The synthetic adapters do not retrieve market data, and the manipulation detector uses supplied signals rather than inspecting a live network.

Alert invalidation is as important as alert creation. A caller can re-evaluate an alert when the score moves, the direction reverses, the evidence becomes unavailable, or the expected half-life expires. Replay then provides a separate path for checking whether the same ordered evidence still produces the same result.

## Verification

```bash
npm run lint
npm run typecheck
npm run test:contracts
npm run test:compliance
npm run test:core
npm run test:all
npm run build
```

`npm run gate:full` is the normal aggregate command: lint, type check, the full test suite, and the compliance-focused tests. The repository contains 38 phase test files spanning contracts, module registration, source guards, retention, ETL quality, scoring, alerting, trace propagation, end-to-end execution, invalidation, and replay.

Tests use synthetic identifiers, evidence, market records, and in-memory stores. They establish implementation behavior and policy enforcement; they do not validate a live feed, external provider, or financial outcome.

## Repository map

| Path | Responsibility |
| --- | --- |
| `contracts/` | Product, source-policy, and data-lifecycle definitions |
| `packages/shared-contracts` | Runtime schemas, DTOs, events, errors, and contract loading |
| `packages/connectors` | Connector behavior, provenance, dedupe, health, and circuit breaking |
| `packages/policy-engine` | Source guards, exceptions, conditional gates, training, retention, and policy service |
| `packages/etl` | Transform jobs, quality checks, quarantine, and lineage |
| `packages/data-layer` | In-memory event, snapshot, cache, feature, and hot-path stores |
| `packages/scoring-engine` | Per-source scoring, fusion, manipulation checks, explanations, and calibration |
| `packages/alerting` | Threshold strategies, cooldowns, routing, and invalidation |
| `packages/app-layer` | Workflow order, middleware, and tracing |
| `packages/observability` | Logs, metrics, SLOs, reliability, and health |
| `packages/replay` | Replay engine, comparison, and audit proofs |
| `packages/integration` | End-to-end pipeline composition |
| `tests/phase-*` | Progressive contract, subsystem, policy, scoring, and lifecycle tests |

## Project boundaries

Sentinel is not a live collector, trading system, brokerage integration, portfolio manager, hosted API, or user interface. It has no production identity layer, durable database, secret manager, operator controls, licensed feeds, or deployment configuration. Express is a dependency of the workspace, but this release does not define a supported public server.

The stores are in-memory implementations for tests and reference flows. A deployed system would need durable transaction boundaries, migrations, tenant isolation, access control, encrypted secrets, source-specific rate limits, retention jobs, monitoring, incident handling, and review of every data license.

The product contract is decision-support only. Scores, explanations, and alerts are analytical records, not investment advice, buy/sell instructions, guaranteed returns, or evidence of predictive performance.

## Documentation and support

- [Product contract](contracts/product_contract.yaml) — permitted outputs and evidence requirements.
- [Source policy](contracts/source_policy.yaml) — allow, conditional, and blocked source rules.
- [Data lifecycle](contracts/data_lifecycle.yaml) — retention classes and deletion proof requirements.
- [Contributing](CONTRIBUTING.md) — contract-change and test expectations.
- [Security](SECURITY.md) — reporting scope and deployment responsibilities.

This is a pre-1.0 reference implementation. Public contracts and package interfaces may change as the model is refined.

## Contributing, security, and license

Changes to source policy, scoring, retention, or alert semantics should include focused tests for both allowed and blocked paths. Use synthetic records only. Do not add account data, licensed feeds, credentials, or investment recommendations.

Report policy bypass, provenance loss, retention failures, serialization issues, or denial-of-service risks through GitHub's private security-advisory channel.

Sentinel Market Intelligence is available under the [MIT License](LICENSE).
