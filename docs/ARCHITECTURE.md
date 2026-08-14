# Architecture and Engineering Decisions

## Goal

Demonstrate an AI-native ERP interaction model where an agent can reason over business state and take action without allowing probabilistic model output to become the authority for identity, permissions, mutation correctness, or verification.

## Trust boundaries

```text
Untrusted / probabilistic
-------------------------
Natural-language input
Model reasoning
Model structured decision

Validated boundary
------------------
Schema validation
Intent routing
Capability scoping

Deterministic control plane
---------------------------
Identity
Authorization
Explicit approval
Typed tool inputs
Idempotency
Optimistic concurrency
ERP mutations
Verification
Audit chain
```

## Why scoped tools

Large ERP products contain hundreds or thousands of operations. Exposing every capability to a model simultaneously increases ambiguity, latency, accidental selection, and prompt-injection blast radius. This project routes intent first and exposes a smaller domain-specific capability set.

## Why authorization is outside the prompt

A prompt can describe policy, but it should not be the enforcement mechanism. Write tools receive authenticated principal context and apply deterministic role policy before mutation.

## Why explicit approval remains separate

Authorization answers whether an actor *may* perform an action. Explicit approval answers whether the actor *intends to perform this consequential action now*. The system requires both.

## Why idempotency and concurrency are both required

Idempotency prevents one logical request from being applied twice. Optimistic concurrency prevents a logically valid request from applying against stale state. They solve different failure modes and are enforced independently.

## Why verification follows execution

A successful tool response is evidence, not truth. The orchestration layer checks the resulting state delta and records verification separately from execution.

## Failure model

Transient tool failures receive a bounded retry budget. Persistent failures fail closed. The agent does not silently substitute model guesses for missing ERP state and does not downgrade authorization because a dependency is unavailable.

## Audit model

Each audit record includes the prior record hash and a SHA-256 digest over a canonical representation. This makes mutation and chain breakage detectable. An optional NDJSON sink gives the same event contract a durable local representation without coupling the core design to one database vendor.

## Production evolution

A real deployment would replace synthetic state and optional NDJSON persistence with transactional ERP/database adapters, centralized identity, short-lived service credentials, distributed idempotency storage, durable event persistence, telemetry, and tenant isolation. Those infrastructure choices should preserve the same core contracts rather than moving safety policy into prompts.
