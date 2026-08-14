# Applied AI ERP Agent

![CI](https://github.com/mrcodeislife718/applied-ai-erp-agent/actions/workflows/ci.yml/badge.svg)

A focused engineering demonstration of an AI-first manufacturing ERP experience: intent routing, grounded retrieval, scoped typed MCP tools, authority checks, post-action state verification, typed UI responses, traces, and evals.

> This project uses synthetic ERP data. It is a targeted engineering proof, not a claim of production customer traffic.

## Showcase scenario

> We may be 300 units short on sales order SO-1842. Find out why and tell me what we can do without delaying the customer.

The system resolves the request, grounds itself in ERP state, narrows the available capability surface, proposes a cross-warehouse transfer, blocks execution without approval, and verifies both the created transfer record and the resulting inventory deltas after an approved write.

## Architecture

```text
User request
  -> intent router
  -> grounded ERP context
  -> capability scope
  -> typed MCP tools
  -> agent/orchestrator
  -> authority gate
  -> ERP state mutation (when approved)
  -> independent state-delta verification
  -> typed UI response
  -> trace + eval evidence
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

Run the MCP server over stdio:

```bash
npm run mcp
```

## MCP tools

- `get-order` — grounded sales-order lookup
- `get-inventory` — SKU inventory by warehouse
- `get-supply-options` — confirmed purchase orders, scheduled production, and alternate inventory
- `propose-transfer` — non-mutating transfer proposal with inventory validation
- `execute-transfer` — approval-gated ERP state mutation

The MCP server uses the stable `@modelcontextprotocol/server` v2 SDK and the 2026-07-28 MCP generation.

## Typed UI surface

The agent returns constrained component descriptors instead of arbitrary generated markup:

- `OrderSummary`
- `InventoryAlert`
- `ActionProposal`
- `ApprovalRequest`
- `ExecutionReceipt`

That keeps model output inside an auditable interface vocabulary while still allowing the experience to be assembled dynamically.

## Evaluation cases

The harness currently checks:

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

## Verification status

GitHub Actions runs `npm run check` on Node 22 and Node 24. The first CI run passed on both runtimes, including TypeScript compilation and the deterministic safety/evaluation suite.

## Why the orchestrator is deterministic by default

The demo deliberately separates probabilistic model reasoning from deterministic authority, ERP mutation, and verification. The MCP boundary is real; an LLM host can call the same tools without moving safety-critical business rules into a prompt.

## Next hardening layers

- model-provider adapter with trace capture
- remote Streamable HTTP MCP transport
- richer intent-routing eval dataset
- tool fault injection and retry budgets
- financial workflow requiring stronger approval policy
- persistence-backed audit log
- recruiter-facing hosted demo polish
