# Applied AI ERP Agent

![CI](https://github.com/mrcodeislife718/applied-ai-erp-agent/actions/workflows/ci.yml/badge.svg)

A focused engineering demonstration of an AI-first manufacturing ERP experience: intent routing, grounded retrieval, scoped typed MCP tools, authority checks, post-action state verification, fault handling, typed UI responses, audit traces, and evals.

> This project uses synthetic ERP data. It is a targeted engineering proof, not a claim of production customer traffic.

## Showcase scenario

> We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.

The system resolves the request, grounds itself in ERP state, narrows the available capability surface, proposes a cross-warehouse transfer, blocks execution without approval, and verifies both the created transfer record and the resulting inventory deltas after an approved write.

## Architecture

```text
User request
  -> intent / validated model decision
  -> grounded ERP context
  -> capability scope
  -> typed MCP tools
  -> retry budget + fault boundary
  -> authority gate
  -> ERP state mutation (when approved)
  -> independent state-delta verification
  -> typed UI response
  -> request trace + append-only audit evidence
```

## Run

Requires Node 22+.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Run typechecking plus the deterministic eval suite:

```bash
npm run check
```

Run the MCP server locally over stdio:

```bash
npm run mcp
```

The web server also exposes the same MCP capability remotely at `POST/GET/DELETE /mcp` through the SDK's Streamable HTTP handler.

## MCP tools

- `get-order` — grounded sales-order lookup
- `get-inventory` — SKU inventory by warehouse
- `get-supply-options` — confirmed purchase orders, scheduled production, and alternate inventory
- `propose-transfer` — non-mutating transfer proposal with inventory validation
- `execute-transfer` — approval-gated ERP state mutation

## Reliability and safe failure

The orchestration layer has deterministic fault injection for timeouts, unavailable tools, and malformed tool results. Retryable read/tool failures use a bounded retry budget. When required state still cannot be obtained, the agent fails closed: it marks the run degraded, blocks writes, emits a `SystemNotice`, and refuses to invent substitute ERP state.

A model-provider abstraction validates structured model decisions with Zod before they can influence tool selection. Invalid model output is stopped before ERP tools or writes execute.

## Typed UI surface

The agent returns constrained component descriptors instead of arbitrary generated markup:

- `OrderSummary`
- `InventoryAlert`
- `ActionProposal`
- `ApprovalRequest`
- `ExecutionReceipt`
- `SystemNotice`

That keeps model output inside an auditable interface vocabulary while still allowing the experience to be assembled dynamically.

## Auditability

Every run receives a unique request ID. Safety-relevant orchestration events are copied into an append-only audit trail and can be inspected through `GET /api/audit/:requestId`. The browser demo exposes both the execution trace and the audit evidence.

## Evaluation cases

The harness checks normal operation and negative paths, including:

- domain/intent routing
- nonexistent-order grounding refusal
- missing-reference ambiguity handling
- safe analysis of SO-1842
- approval blocking before consequential writes
- direct write-tool rejection without approval
- insufficient-inventory rejection
- execution after explicit approval
- source and destination inventory mutation
- post-action state-delta verification
- capability scoping
- transient timeout recovery within the retry budget
- persistent dependency outage -> degraded fail-closed behavior
- execute-tool outage -> no mutation
- append-only audit evidence
- valid structured model decision
- malformed model decision -> blocked before tool execution

## Verification status

GitHub Actions runs `npm run check` on Node 22 and Node 24. CI is the source of truth for whether the current commit compiles and passes the deterministic safety/evaluation suite.

## Why deterministic safety surrounds probabilistic reasoning

The demo deliberately separates probabilistic model reasoning from deterministic authority, ERP mutation, verification, retry policy, and auditing. An LLM can help interpret intent and choose among allowed capabilities, but it cannot make unsafe writes valid by producing persuasive text.

## Next layers

- durable database-backed audit/event persistence
- authenticated remote MCP and per-user authorization
- broader manufacturing and financial workflows
- larger eval corpus with model-quality scoring
- hosted demo deployment and recruiter-facing polish
