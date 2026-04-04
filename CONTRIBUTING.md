# Contributing

Keep provenance, policy state, and replay behavior explicit. Every source-policy, scoring, retention, or alerting change needs contract coverage and a focused test showing both the allowed and blocked path.

```bash
npm run gate:full
npm run build
```

Use synthetic market events and reserved identifiers. Do not add licensed feeds, account data, trading credentials, or investment recommendations.
