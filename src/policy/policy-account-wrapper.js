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

import { PROTOCOL_METHODS } from './constants.js'
import { buildContext } from './policy-context.js'
import { getPolicyContextStore } from './policy-context-store.js'
import PolicyViolationError, { PolicyConfigurationError } from './policy-error.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

const PROTOCOL_GETTERS = [
  ['getSwapProtocol', 'swap'],
  ['getBridgeProtocol', 'bridge'],
  ['getLendingProtocol', 'lending'],
  ['getFiatProtocol', 'fiat']
]

/**
 * Wraps every write method on the given account that's referenced by a
 * registered policy, plus the four protocol getters so protocols returned
 * by them have their write methods wrapped too. Also attaches an
 * `account.simulate.*` mirror that runs evaluation without execution.
 *
 * If no registered policy applies to (chain, path, index), this is a no-op.
 *
 * @internal
 * @param {IWalletAccount} account - The runtime account instance to mutate.
 * @param {object} options
 * @param {string} options.blockchain
 * @param {string | undefined} options.path
 * @param {number | undefined} options.index
 * @param {object} options.engine - The PolicyEngine instance.
 */
export async function applyPoliciesToAccount (account, { blockchain, path, index, engine }) {
  const relevantOps = engine._relevantOperations(blockchain, path, index)

  if (relevantOps.size === 0) return

  if (typeof account.toReadOnlyAccount !== 'function') {
    throw new PolicyConfigurationError(
      `policy engine requires IWalletAccount.toReadOnlyAccount() but the wallet for blockchain '${blockchain}' does not provide it.`
    )
  }

  const store = await getPolicyContextStore()

  const readOnlyAccount = await account.toReadOnlyAccount()

  const wrappedNames = []

  for (const op of relevantOps) {
    if (typeof account[op] === 'function') {
      const original = account[op].bind(account)

      account[op] = makeWrappedMethod({
        name: op,
        original,
        account,
        readOnlyAccount,
        blockchain,
        index,
        engine,
        store
      })

      wrappedNames.push(op)
    }
  }

  for (const [getterName, type] of PROTOCOL_GETTERS) {
    if (typeof account[getterName] !== 'function') continue

    const originalGetter = account[getterName].bind(account)
    const writeMethods = PROTOCOL_METHODS[type]
    const opsToWrap = writeMethods.filter((m) => relevantOps.has(m))

    if (opsToWrap.length === 0) continue

    account[getterName] = (label) => {
      const protocol = originalGetter(label)

      for (const method of opsToWrap) {
        if (typeof protocol[method] !== 'function') continue

        const original = protocol[method].bind(protocol)

        protocol[method] = makeWrappedMethod({
          name: method,
          original,
          account,
          readOnlyAccount,
          blockchain,
          index,
          engine,
          store
        })
      }

      return protocol
    }
  }

  attachSimulateMirror({
    account,
    readOnlyAccount,
    blockchain,
    index,
    engine,
    wrappedNames
  })
}

function makeWrappedMethod ({ name, original, account, readOnlyAccount, blockchain, index, engine, store }) {
  return async function (...args) {
    if (store.getStore()?.inPolicy) {
      return original(...args)
    }

    const context = buildContext({
      operation: name,
      chain: blockchain,
      account: readOnlyAccount,
      args
    })

    const verdict = await engine._evaluateContext(context, { path: account.path, index })

    if (verdict.outcome === 'BLOCK') {
      throw new PolicyViolationError(
        verdict.policyId ?? '<unknown>',
        verdict.ruleName ?? '<unknown>',
        verdict.reason ?? 'unknown'
      )
    }

    return store.run({ inPolicy: true }, () => original(...args))
  }
}

function attachSimulateMirror ({ account, readOnlyAccount, blockchain, index, engine, wrappedNames }) {
  const simulate = Object.create(null)

  for (const name of wrappedNames) {
    simulate[name] = async (...args) => {
      const context = buildContext({
        operation: name,
        chain: blockchain,
        account: readOnlyAccount,
        args
      })

      return engine._simulateContext(context, { path: account.path, index })
    }
  }

  for (const [getterName, type] of PROTOCOL_GETTERS) {
    if (typeof account[getterName] !== 'function') continue

    const writeMethods = PROTOCOL_METHODS[type]

    simulate[getterName] = () => {
      const out = Object.create(null)

      for (const method of writeMethods) {
        out[method] = async (...args) => {
          const context = buildContext({
            operation: method,
            chain: blockchain,
            account: readOnlyAccount,
            args
          })

          return engine._simulateContext(context, { path: account.path, index })
        }
      }

      return out
    }
  }

  account.simulate = simulate
}
