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

import { ruleAddressesOperation } from './policy-validators.js'

/**
 * Evaluates a context against the three policy groups (account, wallet, project)
 * with DENY-wins, narrower-first semantics. Returns a structured verdict, never
 * throws on policy outcomes (it does throw on programmer errors).
 *
 * Outcome shape:
 *   { outcome: 'ALLOW' | 'BLOCK',
 *     policyId: string | null,
 *     ruleName: string | null,
 *     reason:   string | null,
 *     trace:    SimulationTraceEntry[] }
 *
 * @internal
 * @param {object} context
 * @param {{ account: object[], wallet: object[], project: object[] }} groups
 * @param {{ conditionTimeoutMs: number }} options
 */
export async function evaluate (context, groups, options) {
  const trace = []

  const anyAddresses =
    addresses(groups.account, context.operation) ||
    addresses(groups.wallet, context.operation) ||
    addresses(groups.project, context.operation)

  if (!anyAddresses) {
    return makeAllow(null, null, 'not-governed', trace)
  }

  const recordedAllows = []

  const a = await evalGroup(groups.account, context, trace, 'account', { allowOverride: true, ...options })
  if (a.kind === 'DENY') return makeBlock(a.policyId, a.ruleName, a.reason, trace)
  if (a.kind === 'ALLOW_FINAL') return makeAllow(a.policyId, a.ruleName, 'override', trace)
  recordedAllows.push(...a.allows)

  const b = await evalGroup(groups.wallet, context, trace, 'wallet', { allowOverride: false, ...options })
  if (b.kind === 'DENY') return makeBlock(b.policyId, b.ruleName, b.reason, trace)
  recordedAllows.push(...b.allows)

  const c = await evalGroup(groups.project, context, trace, 'project', { allowOverride: false, ...options })
  if (c.kind === 'DENY') return makeBlock(c.policyId, c.ruleName, c.reason, trace)
  recordedAllows.push(...c.allows)

  if (recordedAllows.length > 0) {
    const first = recordedAllows[0]

    return makeAllow(first.policyId, first.ruleName, 'matched', trace)
  }

  return makeBlock(null, null, 'governed-but-unmatched', trace)
}

function addresses (policies, operation) {
  for (const policy of policies) {
    for (const rule of policy.rules) {
      if (ruleAddressesOperation(rule, operation)) return true
    }
  }

  return false
}

async function evalGroup (policies, context, trace, scope, { allowOverride, conditionTimeoutMs }) {
  const allows = []

  for (const policy of policies) {
    for (const rule of policy.rules) {
      if (!ruleAddressesOperation(rule, context.operation)) continue

      const failClose = rule.action === 'DENY'
      const { matched, error } = await evalConditions(rule.conditions, context, { conditionTimeoutMs, failClose })

      trace.push({
        scope,
        policy_id: policy.id,
        rule_name: rule.name,
        matched,
        ...(error !== undefined ? { error } : {})
      })

      if (!matched) continue

      if (rule.action === 'DENY') {
        const reason = error !== undefined
          ? (rule.reason ?? `${rule.name} (condition error: ${error})`)
          : (rule.reason ?? rule.name)

        return { kind: 'DENY', policyId: policy.id, ruleName: rule.name, reason }
      }

      if (allowOverride && rule.override_broader_scope === true) {
        return { kind: 'ALLOW_FINAL', policyId: policy.id, ruleName: rule.name }
      }

      allows.push({ policyId: policy.id, ruleName: rule.name })
    }
  }

  return { kind: 'CONTINUE', allows }
}

/**
 * Evaluates a rule's conditions in order, short-circuiting on the first false.
 *
 * The catch is deliberately broad: condition functions are arbitrary
 * developer-supplied code that can throw any value (sync or async).
 *
 * Fail mode depends on rule action:
 *   - ALLOW rules: a throwing condition is treated as no-match (fail-open as
 *     non-engagement). The DENY-wins layer above still ensures we err safe
 *     when a sibling DENY catches it.
 *   - DENY rules: a throwing condition is treated as a match (fail-closed).
 *     This prevents an attacker from bypassing a DENY by causing its
 *     backing service (e.g. KYT lookup) to throw — when uncertainty
 *     surrounds a deny, block.
 *
 * Each condition is also raced against `conditionTimeoutMs`. A timeout is
 * surfaced as a throw and follows the same fail-mode rules above.
 */
async function evalConditions (conditions, context, { conditionTimeoutMs, failClose }) {
  for (const condition of conditions) {
    try {
      const result = await withTimeout(Promise.resolve(condition(context)), conditionTimeoutMs)

      if (!result) return { matched: false, error: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      return { matched: failClose, error: message }
    }
  }

  return { matched: true, error: undefined }
}

async function withTimeout (promise, ms) {
  let timer

  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`condition timed out after ${ms}ms`)), ms)

    if (typeof timer.unref === 'function') timer.unref()
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

function makeAllow (policyId, ruleName, reason, trace) {
  return { outcome: 'ALLOW', policyId, ruleName, reason, trace }
}

function makeBlock (policyId, ruleName, reason, trace) {
  return { outcome: 'BLOCK', policyId, ruleName, reason, trace }
}
