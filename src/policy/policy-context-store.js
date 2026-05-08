// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

/**
 * Hybrid context store for the policy engine's nested-call escape marker.
 *
 * Exposes a minimal AsyncLocalStorage-shaped interface (`run(value, fn)` +
 * `getStore()`) and chooses the implementation at first use:
 *
 * - On Node (and any runtime that exposes `node:async_hooks.AsyncLocalStorage`)
 *   we wrap the native primitive directly. Zero overhead, exact semantics.
 *   Nested-call escape works as designed.
 *
 * - On Bare (and any runtime without `AsyncLocalStorage`) we fall back to a
 *   no-op store: `getStore()` always returns `undefined`, `run()` just calls
 *   `fn()`. Effect: every wrapped method call evaluates policies
 *   independently, including nested calls.
 *
 *   Why a no-op rather than a polyfilled shim: modern V8 (since 2018)
 *   inlines `await` to skip user-visible `Promise.prototype.then`, so the
 *   Zone.js / Angular technique of patching `.then` no longer captures
 *   context across `await` boundaries. The only correct ways to
 *   propagate async context in V8 today are (a) `AsyncLocalStorage` /
 *   the underlying `async_hooks` async ID tracking or (b) the upcoming
 *   TC39 AsyncContext proposal — both of which require runtime support
 *   that Bare does not currently expose.
 *
 *   The behavioral consequence on Bare is that nested wrapped-method calls
 *   re-evaluate (e.g. when `bridge()` internally calls `sendTransaction()`,
 *   the inner call goes through policy evaluation again). Document this as
 *   a Bare-specific limitation. When the Bare runtime ships
 *   `AsyncLocalStorage` (waiting on TC39 AsyncContext + V8 implementation,
 *   per Holepunch), this no-op fallback is automatically replaced by the
 *   native path with zero code changes.
 *
 * @internal
 */

let storePromise = null

/**
 * Returns the singleton policy context store. Always resolves to a usable
 * store — never null, never throws.
 *
 * @internal
 * @returns {Promise<{ run: (value: unknown, fn: () => unknown) => unknown, getStore: () => unknown }>}
 */
export function getPolicyContextStore () {
  if (storePromise) return storePromise

  storePromise = (async () => {
    try {
      const mod = await import('node:async_hooks')

      if (typeof mod.AsyncLocalStorage === 'function') {
        return new mod.AsyncLocalStorage()
      }
    } catch {
      // Fall through to the user-space shim.
    }

    return createFallbackStore()
  })()

  return storePromise
}

/**
 * Resets the cached store. Test-only; never call from production code.
 *
 * @internal
 */
export function _resetPolicyContextStore () {
  storePromise = null
}

/**
 * Builds the no-op fallback store used on runtimes without
 * `AsyncLocalStorage`. The store reports "no active context" for every
 * call, which means nested-call escape is disabled — every wrapped
 * method call evaluates independently. See the file header for details.
 *
 * @internal
 */
export function createFallbackStore () {
  return {
    run (_value, fn) {
      return fn()
    },
    getStore () {
      return undefined
    }
  }
}
