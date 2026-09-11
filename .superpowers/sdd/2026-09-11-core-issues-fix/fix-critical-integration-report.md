# Fix: Critical Integration - Agent Output Must Reach Condition Functions

**Status:** DONE  
**Date:** 2026-09-11  
**Commit:** (see below)

---

## Problem

The branch review found a CRITICAL integration bug that blocks merge:

Agent output never reaches condition functions. `buildReturn()` in `agent-node.mts` only wrote to `state.results`, but condition functions (`testPass`, `codeReviewPass`, etc.) read from `state.node_outputs[sourceId]` via `sourceText()`. This meant conditions NEVER see agent output, so workflow routing was completely broken.

---

## What Was Fixed

### Fix 1: `buildReturn` populates `node_outputs` (CRITICAL)
**File:** `packages/core/src/graph/agent-node.mts` (line ~319)

Added `node_outputs: { [nodeId]: [output] }` to the default return object, so agent output is written to the state field that condition functions read from.

### Fix 2: `node_outputs` reducer uses merge semantics
**File:** `packages/core/src/graph/state-schema.mts` (TopState + SubState)

Changed reducer from `(_prev, next) => next ?? {}` (replace) to `(prev, next) => ({ ...prev, ...next })` (merge). Without this, each new node output would wipe out all previous node outputs.

### Fix 3: Remove unused `beforeAll` import
**File:** `packages/core/test/parse-output.test.mts` (line 1)

Removed dead import of `beforeAll` from vitest.

### Fix 4: Remove redundant `text === ''` check
**File:** `packages/core/src/graph/conditions/default-conditions.mts` (lines 18, 77)

`!text` already covers empty string. Removed `|| text === ''` in both `parseNodeOutput` and `nodeIssues`.

### Fix 5: Remove unnecessary `nodeType` aliasing
**File:** `packages/core/src/graph/agent-node.mts` (line ~161)

Removed `const nodeType = nodeId` alias; replaced all `nodeType` references with `nodeId` directly.

---

## Test Results

- `pnpm --filter @xuanji/core test`: **44 passed**, 12 skipped (graph-runner DB tests skipped — requires PostgreSQL, unrelated to this fix)
- `pnpm build`: ✅ All 3 packages built successfully (core, runner, dashboard)

### Key test suites affected:
- `test/parse-output.test.mts` — 7/7 ✅
- `test/default-conditions.test.mts` — 7/7 ✅
- `test/agent-workdir.test.mts` — 5/5 ✅
- `test/builder.test.mts` — 16/16 ✅

---

## Commits

```
fix: critical integration - agent output must reach condition functions
```
