# Agent Guide

This repository is part of the Tether WDK (Wallet Development Kit) ecosystem. It follows strict coding conventions and tooling standards to ensure consistency, reliability, and cross-platform compatibility (Node.js and Bare runtime).

## Project Overview
- **Architecture:** Modular architecture with clear separation between Core, Wallet managers, and Protocols.
- **Runtime:** Supports both Node.js and Bare runtime.

## Tech Stack & Tooling
- **Language:** JavaScript (ES2015+).
- **Module System:** ES Modules (`"type": "module"` in package.json).
- **Type Checking:** TypeScript is used purely for generating type declarations (`.d.ts`). The source code remains JavaScript.
  - Command: `npm run build:types`
- **Linting:** `standard` (JavaScript Standard Style).
  - Command: `npm run lint` / `npm run lint:fix`
- **Testing:** `jest` (configured with `experimental-vm-modules` for ESM support).
  - Command: `npm test`
- **Dependencies:** `cross-env` is consistently used for environment variable management in scripts.

## Coding Conventions
- **File Naming:** Kebab-case (e.g., `wallet-manager.js`).
- **Class Naming:** PascalCase (e.g., `WdkManager`).
- **Private Members:** Prefixed with `_` (underscore) and explicitly documented with `@private`.
- **Imports:** Explicit file extensions are mandatory (e.g., `import ... from './file.js'`).
- **Copyright:** All source files must include the standard Tether copyright header.

## Documentation (JSDoc)
Source code must be strictly typed using JSDoc comments to support the `build:types` process.
- **Types:** Use `@typedef` to define or import types.
- **Methods:** Use `@param`, `@returns`, `@throws`.
- **Generics:** Use `@template`.

## Development Workflow
1.  **Install:** `npm install`
2.  **Lint:** `npm run lint`
3.  **Test:** `npm test`
4.  **Build Types:** `npm run build:types`

## Key Files
- `index.js`: Main entry point.
- `bare.js`: Entry point for Bare runtime optimization.
- `src/`: Core logic.
- `types/`: Generated type definitions (do not edit manually).

## Repository Specifics
- **Domain:** Core Orchestrator.
- **Role:** Central entry point for the WDK. Manages lifecycle of multiple wallet instances, protocols, and transaction policies.
- **Key Pattern:** Dependency Injection (registerWallet, registerProtocol, registerPolicy).
- **Architecture:** `WDK` class manages a collection of `WalletManager` instances and a `PolicyEngine` that intercepts write-facing operations on every account returned from `getAccount` / `getAccountByPath`.

## Policy Engine
- Source lives under `src/policy/`. Public surface is the `PolicyViolationError` and `PolicyConfigurationError` classes plus the `Policy*` / `SimulationResult` typedefs re-exported from `index.js`. Everything else under `src/policy/` is internal.
- The engine wraps account write methods and protocol getters at `getAccount` time. Wrapping is dynamic — only methods named in registered rules are wrapped, and only when at least one policy applies.
- Two scopes only: `project` (with optional wallet restriction supplied via the first argument to `registerPolicy`) and `account` (with required wallet binding and a per-account `accounts` list of paths and/or integer indexes). The "wallet" argument is the same string passed to `registerWallet` — an opaque consumer-chosen key, not a blockchain identifier. DENY wins across scopes; account-scope `ALLOW` rules can short-circuit project-scope DENYs via `override_broader_scope: true`.
- Index-form `accounts` entries match the index passed to `wdk.getAccount(wallet, index)`. They do not match accounts retrieved via `getAccountByPath` because the wallet manager has no synchronous path → index resolver. Path-form entries match either retrieval style.
- The "in policy context" marker uses `AsyncLocalStorage` on Node (per-async-chain): concurrent calls on the same account each evaluate independently, while nested calls within one chain skip re-evaluation. The store is selected at first use via `src/policy/policy-context-store.js`. On runtimes without `AsyncLocalStorage` (Bare), the store falls back to a no-op — the engine still works for every other policy behavior, but nested-call escape is disabled (every wrapped call evaluates independently, including nested). Modern V8 inlined `await` to skip user-visible `Promise.prototype.then` years ago, so the Zone.js technique no longer works in pure user-space; we wait for TC39 AsyncContext + V8 + Bare to land before the Bare path matches Node. `node:async_hooks` is loaded lazily so importing WDK on Bare does not crash even if no policy is registered.
- Each condition is raced against `conditionTimeoutMs` (default 30s, settable via `RegisterPolicyOptions`). A condition that throws or times out is fail-closed for DENY rules (treated as matched → block) and fail-open-as-no-match for ALLOW rules.
- Conditions are user-supplied functions in Phase 1. The engine accepts `state` and `onSuccess` rule fields for Phase 2 (engine-managed state + post-execution hooks) but ignores them at runtime; `state` is deep-cloned at registration so callers can't mutate engine state post-registration.
- Tests live in `tests/wdk-manager-policy.test.js` and exercise the engine exclusively through the public WDK API.
