'use strict'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

// Force the policy engine onto the fallback (Promise-patch) backend by
// pretending node:async_hooks does not export AsyncLocalStorage — this is
// exactly what the Bare runtime's bare-async-hooks shim does today.
//
// Jest's unstable_mockModule must be called before the dynamic import of
// the consuming module so the mocked factory is in effect when the policy
// engine's lazy `import('node:async_hooks')` runs.
jest.unstable_mockModule('node:async_hooks', () => ({}))

const WalletManagerModule = await import('@tetherto/wdk-wallet')
const WalletManager = WalletManagerModule.default
const { default: WdkManager } = await import('../index.js')

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const PATH_DEFAULT = "0'/0/0"
const RECIPIENT = '0xrecipient'

const DUMMY_TX_HASH = '0xtx-hash-dummy'
const DUMMY_TRANSFER_HASH = '0xtransfer-hash-dummy'

const sendTransactionMock = jest.fn()
const transferMock = jest.fn()
const getAccountMock = jest.fn()

const WalletManagerMock = jest.fn().mockImplementation(() =>
  Object.create(WalletManager.prototype, {
    getAccount: { value: getAccountMock },
    dispose: { value: jest.fn() }
  })
)

const buildAccount = (path = PATH_DEFAULT) => ({
  path,
  index: parseInt(path.split('/').pop(), 10) || 0,
  sendTransaction: sendTransactionMock,
  transfer: transferMock,
  toReadOnlyAccount: async () => ({
    path,
    getAddress: async () => `0xaddr-${path}`
  })
})

const catchAsync = async (fn) => {
  try { await fn(); return null } catch (err) { return err }
}

describe('WdkManager — policy engine on fallback (Bare-style) context store', () => {
  let wdkManager

  beforeEach(() => {
    sendTransactionMock.mockReset().mockResolvedValue({ hash: DUMMY_TX_HASH })
    transferMock.mockReset().mockResolvedValue({ hash: DUMMY_TRANSFER_HASH })
    getAccountMock.mockReset()

    wdkManager = new WdkManager(SEED_PHRASE)
  })

  test('a project DENY blocks sendTransaction when running on the fallback store', async () => {
    getAccountMock.mockResolvedValue(buildAccount())

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'deny-all',
        name: 'deny-all',
        scope: 'project',
        rules: [{ name: 'r', operation: 'sendTransaction', action: 'DENY', conditions: [] }]
      })

    const account = await wdkManager.getAccount('ethereum', 0)
    const err = await catchAsync(() => account.sendTransaction({ to: RECIPIENT, value: 1n }))

    expect(err.name).toBe('PolicyViolationError')
    expect(err.policyId).toBe('deny-all')
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('a project ALLOW with a passing condition lets the transaction through on the fallback store', async () => {
    getAccountMock.mockResolvedValue(buildAccount())

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'allow-small',
        name: 'allow-small',
        scope: 'project',
        rules: [{
          name: 'allow',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [({ params }) => BigInt(params.value) <= 5n]
        }]
      })

    const account = await wdkManager.getAccount('ethereum', 0)
    const result = await account.sendTransaction({ to: RECIPIENT, value: 1n })

    expect(result.hash).toBe(DUMMY_TX_HASH)
    expect(sendTransactionMock).toHaveBeenCalledWith({ to: RECIPIENT, value: 1n })
  })

  test('async conditions resolve correctly across an await on the fallback store', async () => {
    getAccountMock.mockResolvedValue(buildAccount())

    let conditionRan = 0

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'p',
        name: 'p',
        scope: 'project',
        rules: [{
          name: 'r',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [async ({ params }) => {
            await Promise.resolve()
            await Promise.resolve()
            conditionRan++
            return BigInt(params.value) <= 5n
          }]
        }]
      })

    const account = await wdkManager.getAccount('ethereum', 0)
    const result = await account.sendTransaction({ to: RECIPIENT, value: 1n })

    expect(result.hash).toBe(DUMMY_TX_HASH)
    expect(conditionRan).toBe(1)
  })

  test('on the fallback store, nested wrapped-method calls re-evaluate (documented limitation)', async () => {
    // Modern V8 inlines `await` to skip user-visible `Promise.prototype.then`,
    // so user-space code cannot propagate context across awaits without
    // runtime support (`AsyncLocalStorage` or TC39 AsyncContext, neither
    // of which Bare currently exposes). The fallback path therefore disables
    // nested-call escape — every wrapped method call evaluates independently.
    // This test pins that behavior so it isn't accidentally regressed once
    // a real cross-await store becomes available.
    let conditionInvocations = 0
    const account = buildAccount()

    transferMock.mockImplementation(async (opts) => {
      await Promise.resolve()
      return account.sendTransaction({ to: opts.to, value: opts.value })
    })

    getAccountMock.mockResolvedValue(account)

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'p',
        name: 'p',
        scope: 'project',
        rules: [{
          name: 'r',
          operation: ['transfer', 'sendTransaction'],
          action: 'ALLOW',
          conditions: [() => { conditionInvocations++; return true }]
        }]
      })

    const wrappedAccount = await wdkManager.getAccount('ethereum', 0)
    const result = await wrappedAccount.transfer({ to: RECIPIENT, value: 1n })

    expect(result.hash).toBe(DUMMY_TX_HASH)
    // Outer transfer + inner sendTransaction both go through full evaluation.
    expect(conditionInvocations).toBe(2)
  })

  test('concurrent external calls on the same account each evaluate independently on the fallback store (no marker bleed-through)', async () => {
    let conditionInvocations = 0
    const accountInstance = buildAccount()

    sendTransactionMock.mockImplementation(async (opts) => {
      await Promise.resolve()
      await Promise.resolve()
      return { hash: `0x${opts.value}` }
    })

    getAccountMock.mockResolvedValue(accountInstance)

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'p',
        name: 'p',
        scope: 'project',
        rules: [{
          name: 'r',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [async () => { await Promise.resolve(); conditionInvocations++; return true }]
        }]
      })

    const account = await wdkManager.getAccount('ethereum', 0)

    // Fire two external calls concurrently. With the per-account-flag bug,
    // call B would see call A's flag and skip its own evaluation. With the
    // fallback store correctly isolating contexts, both must evaluate.
    const [a, b] = await Promise.all([
      account.sendTransaction({ to: RECIPIENT, value: 1n }),
      account.sendTransaction({ to: RECIPIENT, value: 2n })
    ])

    expect(a.hash).toBe('0x1')
    expect(b.hash).toBe('0x2')
    expect(conditionInvocations).toBe(2)
  })

  test('account.simulate on the fallback store returns the same shape as the native path', async () => {
    getAccountMock.mockResolvedValue(buildAccount())

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'cap',
        name: 'cap',
        scope: 'project',
        rules: [{
          name: 'allow-small',
          operation: 'sendTransaction',
          action: 'ALLOW',
          conditions: [({ params }) => BigInt(params.value) <= 5n]
        }]
      })

    const account = await wdkManager.getAccount('ethereum', 0)

    const allowed = await account.simulate.sendTransaction({ to: RECIPIENT, value: 1n })
    const denied = await account.simulate.sendTransaction({ to: RECIPIENT, value: 100n })

    expect(allowed.decision).toBe('ALLOW')
    expect(allowed.policy_id).toBe('cap')
    expect(allowed.matched_rule).toBe('allow-small')

    expect(denied.decision).toBe('DENY')
    expect(denied.reason).toBe('governed-but-unmatched')
    // simulate must never invoke the underlying method.
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('a thrown DENY condition still fail-closes correctly on the fallback store', async () => {
    getAccountMock.mockResolvedValue(buildAccount())

    wdkManager
      .registerWallet('ethereum', WalletManagerMock, {})
      .registerPolicy({
        id: 'sanctions',
        name: 'sanctions',
        scope: 'project',
        rules: [
          {
            name: 'block',
            operation: 'sendTransaction',
            action: 'DENY',
            conditions: [async () => { await Promise.resolve(); throw new Error('KYT down') }]
          },
          {
            name: 'general-allow',
            operation: 'sendTransaction',
            action: 'ALLOW',
            conditions: [() => true]
          }
        ]
      })

    const account = await wdkManager.getAccount('ethereum', 0)
    const err = await catchAsync(() => account.sendTransaction({ to: RECIPIENT, value: 1n }))

    expect(err.name).toBe('PolicyViolationError')
    expect(err.policyId).toBe('sanctions')
    expect(err.ruleName).toBe('block')
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })
})
