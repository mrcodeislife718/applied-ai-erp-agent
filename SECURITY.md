# Security Notes

This repository is a showcase built on synthetic ERP data, but the security boundaries are intentional.

## Implemented controls

- signed, expiring bearer sessions
- role-based authorization outside prompts
- separate explicit-approval requirement for consequential writes
- authenticated remote MCP context
- narrow domain capability scoping
- typed/Zod-validated tool inputs
- idempotency keys for writes
- optimistic-concurrency version checks
- fail-closed dependency handling
- model-decision schema validation
- post-action state verification
- SHA-256 chained audit records
- request-body limits
- basic rate limiting
- CSP and common HTTP security headers

## Deployment requirements

Set a strong `SESSION_SECRET` in any persistent or multi-instance deployment. Set `DEMO_MODE=false` when public demo-role issuance is not desired. Do not treat the optional local NDJSON audit file as a distributed production event store.

## Production gaps intentionally left as infrastructure adapters

A customer deployment should add centralized identity/OIDC, tenant isolation, database-backed idempotency and audit storage, secret management, network policy, distributed rate limiting, telemetry/alerting, backup/retention policy, and real ERP authorization mapping.

No real customer, payment, inventory, or manufacturing data is included in this repository.
