# Applied AI ERP Agent

![CI](https://github.com/mrcodeislife718/applied-ai-erp-agent/actions/workflows/ci.yml/badge.svg)

A production-minded engineering showcase for AI-first ERP: grounded agent workflows, scoped typed MCP tools, role-based authority, explicit approvals, idempotent writes, optimistic concurrency, independent verification, fault handling, typed UI responses, model-boundary validation, and tamper-evident audit evidence.

> This project uses synthetic ERP data. It is an engineering proof, not a claim of production customer traffic.

## Showcase workflows

### Inventory shortage

> We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.

The agent resolves intent, reads the real synthetic ERP state, scopes its capability surface, finds alternate inventory and incoming supply, proposes a transfer, blocks execution without explicit approval and an authorized operator, executes idempotently, and verifies the resulting inventory delta.

### Manufacturing

> Show me the current production status for manufacturing order MO-92.

The agent grounds itself in the manufacturing order and related supply context, then returns a constrained `ProductionStatus` component rather than arbitrary generated UI.

### Financial approval

> Review and approve invoice INV-300.

The invoice can be read by any authenticated session, but the approval write requires both explicit approval and the `finance-approver` role. The write is idempotent, version-checked, recorded with actor identity, and verified after mutation.

## Architecture

```text
User request
  -> signed session identity
  -> intent / validated model decision
  -> domain capability scope
  -> grounded ERP state
  -> typed MCP tools
  -> bounded retry + fault boundary
  -> deterministic authorization policy
  -> explicit approval gate
  -> idempotency + optimistic concurrency
  -> ERP state mutation
  -> independent post-action verification
  -> typed AI-native UI
  -> request trace
  -> SHA-256 chained audit evidence
```

The core design principle is deliberate: probabilistic model reasoning may interpret intent, but it does not own authorization, business-state mutation, verification, concurrency control, or audit truth.

## Run locally

Requires Node 22+.

```bash
npm install
npm run check
npm run dev
```

Open `http://localhost:3000`.

The browser demo can mint short-lived signed demo sessions for four roles:

- `viewer`
- `planner`
- `operator`
- `finance-approver`

Set `DEMO_MODE=false` to disable demo-session issuance outside a showcase environment. Set `SESSION_SECRET` in deployed environments so sessions remain verifiable across instances.

## MCP

Run the local stdio server:

```bash
npm run mcp
```

The Express application also exposes authenticated remote MCP at `/mcp`. Remote MCP receives the same signed principal context as the HTTP API; MCP write tools do not get a privileged bypass.

Typed tools:

- `get-order`
- `get-inventory`
- `get-supply-options`
- `get-production-order`
- `get-invoice`
- `propose-transfer`
- `execute-transfer`
- `approve-invoice`

## Safety and correctness layers

### Grounding

Missing orders, manufacturing records, invoices, or required inventory state cause the workflow to stop. The agent does not fabricate substitute ERP state.

### Capability scoping

Each domain receives a narrow tool surface. Inventory/order workflows do not automatically expose financial approval capabilities, and financial workflows do not receive unrelated inventory writes.

### Authorization

Consequential actions are checked outside the prompt:

- warehouse transfer execution -> `operator` or `finance-approver`
- invoice approval -> `finance-approver`

### Explicit approval

Possessing a capable role is not enough. Consequential writes still require an explicit approval signal.

### Idempotency

Write tools require idempotency keys. Replaying the same operation returns the prior result instead of mutating ERP state twice. Reusing the same key for a different operation fails with an idempotency conflict.

### Optimistic concurrency

Inventory and financial records carry versions. Writes can include expected versions and fail safely when the underlying state changed after the agent read it.

### Verification

A successful tool response is not treated as proof by itself. The orchestration layer verifies the resulting state change and emits an `ExecutionReceipt` with verification evidence.

### Fault tolerance

Deterministic fault injection covers:

- timeout
- unavailable dependency
- malformed tool output

Retryable failures receive a bounded retry budget. Persistent failures put the run into a degraded, fail-closed state and block writes.

### Model boundary validation

`ModelProvider` outputs are parsed through a strict Zod schema before they can affect orchestration. Malformed model output is stopped before ERP tools execute.

### Tamper-evident audit

Every safety-relevant event is appended to an audit chain containing `previousHash` and a deterministic SHA-256 digest. `verifyAuditChain()` detects mutation or chain breakage.

Set `AUDIT_FILE=/path/to/audit.ndjson` to persist the chain to append-only NDJSON for a long-running deployment. The in-memory store remains available for ephemeral/serverless showcase environments.

## Typed UI vocabulary

The server returns constrained component descriptors instead of arbitrary model-authored markup:

- `OrderSummary`
- `InventoryAlert`
- `ProductionStatus`
- `FinancialApproval`
- `ActionProposal`
- `ApprovalRequest`
- `ExecutionReceipt`
- `SystemNotice`

This creates an auditable interface vocabulary that both humans and models can compose safely.

## Evaluation harness

`npm test` runs a deterministic evaluation suite across normal and adversarial behavior, including:

- intent routing across inventory, manufacturing, and financial domains
- missing and nonexistent ERP records
- tool-surface scoping
- explicit approval enforcement
- role-based authorization
- successful transfer mutation and state verification
- insufficient-inventory rejection
- idempotent replay
- idempotency-key conflict
- optimistic-concurrency conflict
- transient timeout recovery
- persistent dependency outage
- execute-tool outage with zero mutation
- malformed tool result fail-closed behavior
- manufacturing grounding
- financial approval policy
- signed-session verification and expiry
- audit-stage capture
- audit hash-chain validation
- NDJSON audit persistence
- valid structured model decision
- malformed model decision blocked before tools
- unknown-intent refusal

GitHub Actions runs `npm run check` on Node 22 and Node 24. CI is the source of truth for whether the current commit compiles and passes the full deterministic suite.

## HTTP surface

- `GET /healthz`
- `POST /api/demo/session`
- `POST /api/agent`
- `GET /api/audit/:requestId`
- `GET /api/metrics`
- `GET /api/state`
- `GET|POST|DELETE /mcp`

The API includes request-body limits, basic per-IP rate limiting, security headers, signed bearer sessions, and a CSP for the browser showcase.

## Deployment

The Express app is exported as the default module export for modern serverless deployment platforms while still supporting local `app.listen()` development. For durable audit storage in a multi-instance production deployment, replace the optional NDJSON file sink with a transactional database/event store while keeping the same audit-chain contract.

## Interview discussion points

This project is intentionally built to make engineering tradeoffs inspectable. Useful questions to ask or answer from the codebase include:

- Why should a model not see hundreds of ERP tools at once?
- Why is authentication different from authorization?
- Why is explicit user approval still needed after authorization succeeds?
- How do idempotency and optimistic concurrency prevent different classes of duplicate/stale writes?
- What should happen when retrieval succeeds but a downstream write tool is unavailable?
- Why verify resulting ERP state instead of trusting a successful tool response?
- What belongs in deterministic policy versus an LLM prompt?
- How should an AI-native UI constrain what a model is allowed to render?
- How do you measure whether an agent is actually improving rather than merely sounding better?

Those are the design problems this repository is meant to demonstrate with runnable evidence rather than claims.
