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

import { createPolicyEnforcedAccount } from './policy-account-proxy.js'
import { PolicyConfigurationError } from './policy-error.js'
import { evaluate } from './policy-evaluator.js'
import PolicyRegistry from './policy-registry.js'
import {
  collectReferencedOperations,
  validatePolicy,
  validateRegisterOptions
} from './policy-validators.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/**
 * @typedef {'ALLOW' | 'DENY'} PolicyAction
 */

/**
 * @typedef {'project' | 'account'} PolicyScope
 */

/**
 * @typedef {'sendTransaction' | 'transfer' | 'approve' | 'signMessage' | 'signHash'
 *   | 'signTypedData' | 'signAuthorization' | 'delegate' | 'revokeDelegation'
 *   | 'swap' | 'bridge' | 'supply' | 'withdraw' | 'borrow' | 'repay' | 'buy' | 'sell'
 *   | '*'} PolicyOperation
 */

/**
 * @typedef {object} PolicyContext
 * @property {PolicyOperation} operation - The intercepted operation name.
 * @property {string} wallet - The wallet identifier (the same string passed to `wdk.registerWallet`). Despite the name, this is an opaque key chosen by the consumer — it might be a chain name like `"ethereum"`, but it could equally be `"treasury-cold"` or any other label.
 * @property {IWalletAccountReadOnly} account - A read-only view of the wallet account.
 * @property {unknown} params - The first argument to the wrapped method.
 * @property {readonly unknown[]} args - The full argument array.
 */

/**
 * @typedef {(context: PolicyContext) => boolean | Promise<boolean>} PolicyCondition
 */

/**
 * @typedef {object} PolicyRule
 * @property {string} name
 * @property {string} [reason] - Optional human-readable explanation. When set on a DENY rule that matches, propagates to PolicyViolationError.reason and to the matching simulate-result. Defaults to the rule's name.
 * @property {PolicyOperation | PolicyOperation[]} operation
 * @property {PolicyAction} action
 * @property {boolean} [override_broader_scope] - When true on an account-scope ALLOW rule that matches, the rule's verdict short-circuits both wallet- and project-scope evaluation. Account-scope rules are evaluated in registration order; the first matching override-flag rule wins. Only valid on account-scope ALLOW rules.
 * @property {PolicyCondition[]} conditions
 * @property {object} [state]                                       Reserved for Phase 2; ignored at runtime.
 * @property {(c: PolicyContext) => void | Promise<void>} [onSuccess]   Reserved for Phase 2; ignored at runtime.
 */

/**
 * @typedef {string | number} AccountIdentifier
 */

/**
 * @typedef {object} Policy
 * @property {string} id
 * @property {string} name
 * @property {PolicyScope} scope
 * @property {string | string[]} [wallet] - The wallet identifier(s) this policy binds to. Each entry must match a string previously passed to `wdk.registerWallet`. For `scope: 'project'`, omitting `wallet` applies the policy across every registered wallet; providing one or more narrows it to those wallets. For `scope: 'account'`, `wallet` is required.
 * @property {AccountIdentifier[]} [accounts] - The accounts this policy applies to (required when scope is 'account'). Each entry is either a derivation path (exact-string match against `account.path`) or a non-negative integer (match against the index passed to `wdk.getAccount(wallet, index)`). Index entries do not match accounts retrieved via `getAccountByPath` — use derivation paths if you need both retrieval styles to work.
 * @property {PolicyRule[]} rules
 */

/**
 * @typedef {object} RegisterPolicyOptions
 * @property {object} [state] - Reserved for Phase 2.
 * @property {number} [conditionTimeoutMs] - Per-condition evaluation timeout in milliseconds. Defaults to 30000. A condition that exceeds the timeout is treated the same as a throw — fail-closed for DENY rules, fail-open-as-no-match for ALLOW rules. Engine-wide; the most recent registerPolicy call's value wins.
 */

/**
 * @typedef {object} SimulationTraceEntry
 * @property {PolicyScope} scope
 * @property {string} policy_id
 * @property {string} rule_name
 * @property {boolean} matched
 * @property {string} [error]
 */

/**
 * @typedef {object} SimulationResult
 * @property {'ALLOW' | 'DENY'} decision
 * @property {string | null} policy_id
 * @property {string | null} matched_rule
 * @property {string | null} reason
 * @property {SimulationTraceEntry[]} trace
 */

/**
 * @internal
 *
 * The orchestration façade. Owns the registry; exposes the two methods the
 * `WDK` class calls (`register`, `applyPoliciesTo`). Internal helpers
 * (`_relevantOperations`, `_evaluateContext`, `_simulateContext`) are used
 * by the wrapper module.
 */
const DEFAULT_CONDITION_TIMEOUT_MS = 30_000

export default class PolicyEngine {
  constructor () {
    /** @private */
    this._registry = new PolicyRegistry()

    /** @private */
    this._conditionTimeoutMs = DEFAULT_CONDITION_TIMEOUT_MS
  }

  /**
   * Registers one or more policies. Synchronously throws on validation failures.
   * Validation runs to completion before any registry mutation, so a failure
   * never leaves the engine partially mutated.
   *
   * @param {Policy | Policy[]} policies
   * @param {RegisterPolicyOptions} [options]
   * @param {{ knownWallets?: Set<string> }} [registrationContext] - Optional
   *   set of registered wallet identifiers. When provided, the engine verifies
   *   every wallet binding referenced by the policies is in this set before
   *   touching the registry.
   */
  register (policies, options, registrationContext) {
    validateRegisterOptions(options)

    const list = Array.isArray(policies) ? policies : [policies]

    if (list.length === 0) {
      throw new PolicyConfigurationError('Policy: must be an object or a non-empty array of objects.')
    }

    const walletsPerPolicy = list.map((policy) => validatePolicy(policy))

    const knownWallets = registrationContext?.knownWallets

    if (knownWallets) {
      for (const wallets of walletsPerPolicy) {
        if (!wallets) continue

        for (const w of wallets) {
          if (!knownWallets.has(w)) {
            throw new PolicyConfigurationError(`registerPolicy: no wallet registered with identifier '${w}'.`)
          }
        }
      }
    }

    list.forEach((policy, i) => {
      this._registry.add(policy, walletsPerPolicy[i])
    })

    if (options?.conditionTimeoutMs !== undefined) {
      this._conditionTimeoutMs = options.conditionTimeoutMs
    }
  }

  /**
   * Returns a policy-enforced view of the given account — a Proxy that
   * exposes enforced versions of write methods. The original account is
   * never mutated. If no policy applies, returns the original account.
   *
   * @param {object} account
   * @param {object} ctx
   * @param {string} ctx.blockchain - The wallet identifier (named `blockchain` here to match the WDK manager's existing API; the policy engine treats it as an opaque wallet key).
   * @param {string | undefined} ctx.path
   * @param {number | undefined} [ctx.index] - The index passed to `wdk.getAccount(wallet, index)`, when known. Used to match index-form entries in `policy.accounts`.
   * @returns {Promise<object>} The enforced proxy, or the original account if no policy applies.
   */
  async applyPoliciesTo (account, { blockchain, path, index }) {
    return createPolicyEnforcedAccount(account, { blockchain, path, index, engine: this })
  }

  /**
   * Removes account-scope and chain-bound project policies registered under
   * the given wallet identifier.
   *
   * @param {string} wallet
   */
  disposeWallet (wallet) {
    this._registry.disposeWallet(wallet)
  }

  /**
   * Removes all registered policies across every bucket.
   */
  disposeAll () {
    this._registry.disposeAll()
  }

  /** @private */
  _relevantOperations (wallet, path, index) {
    return collectReferencedOperations(this._registry.relevant(wallet, path, index))
  }

  /** @private */
  async _evaluateContext (context, { path, index }) {
    const groups = this._registry.applicable(context.wallet, path, index)

    return evaluate(context, groups, { conditionTimeoutMs: this._conditionTimeoutMs })
  }

  /** @private */
  async _simulateContext (context, { path, index }) {
    const verdict = await this._evaluateContext(context, { path, index })

    return {
      decision: verdict.outcome === 'BLOCK' ? 'DENY' : 'ALLOW',
      policy_id: verdict.policyId,
      matched_rule: verdict.ruleName,
      reason: verdict.reason,
      trace: verdict.trace
    }
  }
}
