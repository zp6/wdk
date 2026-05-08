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

import WalletManager from '@tetherto/wdk-wallet'

import { SwapProtocol, BridgeProtocol, LendingProtocol, FiatProtocol } from '@tetherto/wdk-wallet/protocols'

import PolicyEngine from './policy/policy-engine.js'
import { PolicyConfigurationError } from './policy/policy-error.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */

/** @typedef {import('./wallet-account-with-protocols.js').IWalletAccountWithProtocols} IWalletAccountWithProtocols */

/** @typedef {<A extends IWalletAccount>(account: A) => Promise<void>} MiddlewareFunction */

/** @typedef {import('./policy/policy-engine.js').Policy} Policy */

/** @typedef {import('./policy/policy-engine.js').PolicyRule} PolicyRule */

/** @typedef {import('./policy/policy-engine.js').PolicyCondition} PolicyCondition */

/** @typedef {import('./policy/policy-engine.js').PolicyContext} PolicyContext */

/** @typedef {import('./policy/policy-engine.js').PolicyAction} PolicyAction */

/** @typedef {import('./policy/policy-engine.js').PolicyScope} PolicyScope */

/** @typedef {import('./policy/policy-engine.js').PolicyOperation} PolicyOperation */

/** @typedef {import('./policy/policy-engine.js').SimulationResult} SimulationResult */

/** @typedef {import('./policy/policy-engine.js').RegisterPolicyOptions} RegisterPolicyOptions */

export default class WDK {
  /**
   * Creates a new wallet development kit instance.
   *
   * @param {string | Uint8Array} seed - The wallet's BIP-39 seed phrase.
   * @throws {Error} If the seed is not valid.
   */
  constructor (seed) {
    if (!WDK.isValidSeed(seed)) {
      throw new Error('Invalid seed.')
    }

    /** @private */
    this._seed = seed

    /** @private */
    this._wallets = new Map()

    /** @private */
    this._protocols = { swap: Object.create(null), bridge: Object.create(null), lending: Object.create(null), fiat: Object.create(null) }

    /** @private */
    this._middlewares = Object.create(null)

    /** @private */
    this._policyEngine = new PolicyEngine()
  }

  /**
   * Returns a random BIP-39 seed phrase.
   *
   * @param {12 | 24} [wordCount] - The number of words to include in the seed phrase (default: 12).
   * @returns {string} The seed phrase.
   */
  static getRandomSeedPhrase (wordCount = 12) {
    return WalletManager.getRandomSeedPhrase(wordCount)
  }

  /**
   * Checks if a seed is valid.
   *
   * @param {string | Uint8Array} seed - The seed.
   * @returns {boolean} True if the seed is valid.
   */
  static isValidSeed (seed) {
    if (seed instanceof Uint8Array) {
      return seed.length >= 16 && seed.length <= 64
    }

    return WalletManager.isValidSeedPhrase(seed)
  }

  /**
   * Registers a new wallet to WDK.
   *
   * @template {typeof WalletManager} W
   * @param {string} blockchain - The name of the blockchain the wallet must be bound to. Can be any string (e.g., "ethereum").
   * @param {W} WalletManager - The wallet manager class.
   * @param {ConstructorParameters<W>[1]} config - The configuration object.
   * @returns {WDK} The wdk instance.
   */
  registerWallet (blockchain, WalletManager, config) {
    const wallet = new WalletManager(this._seed, config)

    this._wallets.set(blockchain, wallet)

    return this
  }

  /**
   * Registers a new protocol to WDK.
   *
   * The label must be unique in the scope of the blockchain and the type of protocol (i.e., there can't be two protocols of the
   * same type bound to the same blockchain with the same label).
   *
   * @see {@link IWalletAccountWithProtocols#registerProtocol} to register protocols only for specific accounts.
   * @template {typeof SwapProtocol | typeof BridgeProtocol | typeof LendingProtocol | typeof FiatProtocol} P
   * @param {string} blockchain - The name of the blockchain the protocol must be bound to. Can be any string (e.g., "ethereum").
   * @param {string} label - The label.
   * @param {P} Protocol - The protocol class.
   * @param {ConstructorParameters<P>[1]} config - The protocol configuration.
   * @returns {WDK} The wdk instance.
   */
  registerProtocol (blockchain, label, Protocol, config) {
    if (Protocol.prototype instanceof SwapProtocol) {
      this._protocols.swap[blockchain] ??= Object.create(null)

      this._protocols.swap[blockchain][label] = { Protocol, config }
    } else if (Protocol.prototype instanceof BridgeProtocol) {
      this._protocols.bridge[blockchain] ??= Object.create(null)

      this._protocols.bridge[blockchain][label] = { Protocol, config }
    } else if (Protocol.prototype instanceof LendingProtocol) {
      this._protocols.lending[blockchain] ??= Object.create(null)

      this._protocols.lending[blockchain][label] = { Protocol, config }
    } else if (Protocol.prototype instanceof FiatProtocol) {
      this._protocols.fiat[blockchain] ??= Object.create(null)

      this._protocols.fiat[blockchain][label] = { Protocol, config }
    }

    return this
  }

  /**
   * Registers a new middleware to WDK.
   *
   * It's possible to register multiple middlewares for the same blockchain, which will be called sequentially.
   *
   * @param {string} blockchain - The name of the blockchain the middleware must be bound to. Can be any string (e.g., "ethereum").
   * @param {MiddlewareFunction} middleware - A callback function that is called each time the user derives a new account.
   * @returns {WDK} The wdk instance.
   */
  registerMiddleware (blockchain, middleware) {
    this._middlewares[blockchain] ??= []

    this._middlewares[blockchain].push(middleware)

    return this
  }

  /**
   * Registers one or more transaction policies that will be evaluated before
   * any wrapped account or protocol method is allowed to execute.
   *
   * The first argument may be a wallet identifier (string), a list of
   * wallet identifiers (string[]), or omitted entirely. The wallet identifier
   * is the same string passed to `registerWallet` — it might be a chain name
   * like `"ethereum"`, but it could equally be `"treasury-cold"` or any
   * label the consumer chose. When omitted, project-scope policies are
   * applied across every registered wallet. When provided, project-scope
   * policies are narrowed to those wallets and account-scope policies are
   * bound to them.
   *
   * Multiple `registerPolicy` calls stack. If a policy with the same id is
   * registered twice into the same wallet binding, the second call replaces
   * the first.
   *
   * @overload
   * @param {Policy | Policy[]} policies
   * @param {RegisterPolicyOptions} [options]
   * @returns {WDK}
   */
  /**
   * @overload
   * @param {string | string[]} wallet
   * @param {Policy | Policy[]} policies
   * @param {RegisterPolicyOptions} [options]
   * @returns {WDK}
   */
  /**
   * @param {string | string[] | Policy | Policy[]} walletOrPolicies
   * @param {Policy | Policy[] | RegisterPolicyOptions} [policiesOrOptions]
   * @param {RegisterPolicyOptions} [maybeOptions]
   * @returns {WDK}
   */
  registerPolicy (walletOrPolicies, policiesOrOptions, maybeOptions) {
    let wallet
    let policies
    let options

    if (typeof walletOrPolicies === 'string' || Array.isArray(walletOrPolicies)) {
      const isPolicyArray = Array.isArray(walletOrPolicies) &&
        walletOrPolicies.length > 0 &&
        walletOrPolicies.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))

      if (isPolicyArray) {
        wallet = undefined
        policies = walletOrPolicies
        options = policiesOrOptions
      } else {
        wallet = walletOrPolicies
        policies = policiesOrOptions
        options = maybeOptions
      }
    } else {
      wallet = undefined
      policies = walletOrPolicies
      options = policiesOrOptions
    }

    if (Array.isArray(wallet)) {
      for (const w of wallet) {
        if (typeof w === 'string' && w.length > 0 && !this._wallets.has(w)) {
          throw new PolicyConfigurationError(`registerPolicy: no wallet registered with identifier '${w}'.`)
        }
      }
    } else if (typeof wallet === 'string' && !this._wallets.has(wallet)) {
      throw new PolicyConfigurationError(`registerPolicy: no wallet registered with identifier '${wallet}'.`)
    }

    this._policyEngine.register(wallet, policies, options)

    return this
  }

  /**
   * Returns the wallet account for a specific blockchain and index (see BIP-44).
   *
   * @param {string} blockchain - The name of the blockchain (e.g., "ethereum").
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<IWalletAccountWithProtocols>} The account.
   * @throws {Error} If no wallet has been registered for the given blockchain.
   */
  async getAccount (blockchain, index = 0) {
    if (!this._wallets.has(blockchain)) {
      throw new Error(`No wallet registered for blockchain: ${blockchain}.`)
    }

    const wallet = this._wallets.get(blockchain)

    const account = await wallet.getAccount(index)

    await this._runMiddlewares(account, { blockchain })

    this._registerProtocols(account, { blockchain })

    await this._applyPolicies(account, { blockchain, index })

    return account
  }

  /**
   * Returns the wallet account for a specific blockchain and BIP-44 derivation path.
   *
   * @param {string} blockchain - The name of the blockchain (e.g., "ethereum").
   * @param {string} path - The derivation path (e.g., "0'/0/0").
   * @returns {Promise<IWalletAccountWithProtocols>} The account.
   * @throws {Error} If no wallet has been registered for the given blockchain.
   */
  async getAccountByPath (blockchain, path) {
    if (!this._wallets.has(blockchain)) {
      throw new Error(`No wallet registered for blockchain: ${blockchain}.`)
    }

    const wallet = this._wallets.get(blockchain)

    const account = await wallet.getAccountByPath(path)

    await this._runMiddlewares(account, { blockchain })

    this._registerProtocols(account, { blockchain })

    await this._applyPolicies(account, { blockchain })

    return account
  }

  /**
   * Returns the current fee rates for a specific blockchain.
   *
   * @param {string} blockchain - The name of the blockchain (e.g., "ethereum").
   * @returns {Promise<FeeRates>} The fee rates (in base unit).
   * @throws {Error} If no wallet has been registered for the given blockchain.
   */
  async getFeeRates (blockchain) {
    if (!this._wallets.has(blockchain)) {
      throw new Error(`No wallet registered for blockchain: ${blockchain}.`)
    }

    const wallet = this._wallets.get(blockchain)

    const feeRates = await wallet.getFeeRates()

    return feeRates
  }

  /**
   * Disposes and unregisters wallets, erasing any sensitive data from memory.
   * If no blockchains are specified, all registered wallets are disposed.
   * @param {string[]} [blockchains] - The blockchains to dispose. If omitted, all wallets are disposed.
   */
  dispose (blockchains) {
    for (const [blockchain, wallet] of this._wallets) {
      if (!blockchains || blockchains.includes(blockchain)) {
        wallet.dispose()
        this._wallets.delete(blockchain)
        this._policyEngine.disposeWallet(blockchain)
      }
    }

    if (!blockchains) {
      this._policyEngine.disposeAll()
    }
  }

  /** @private */
  async _applyPolicies (account, { blockchain, index }) {
    await this._policyEngine.applyPoliciesTo(account, { blockchain, path: account.path, index })
  }

  /** @private */
  async _runMiddlewares (account, { blockchain }) {
    if (this._middlewares[blockchain]) {
      for (const middleware of this._middlewares[blockchain]) {
        await middleware(account)
      }
    }
  }

  /** @private */
  _registerProtocols (account, { blockchain }) {
    const protocols = { swap: Object.create(null), bridge: Object.create(null), lending: Object.create(null), fiat: Object.create(null) }

    account.registerProtocol = (label, Protocol, config) => {
      if (Protocol.prototype instanceof SwapProtocol) {
        protocols.swap[label] = new Protocol(account, config)
      } else if (Protocol.prototype instanceof BridgeProtocol) {
        protocols.bridge[label] = new Protocol(account, config)
      } else if (Protocol.prototype instanceof LendingProtocol) {
        protocols.lending[label] = new Protocol(account, config)
      } else if (Protocol.prototype instanceof FiatProtocol) {
        protocols.fiat[label] = new Protocol(account, config)
      }

      return account
    }

    account.getSwapProtocol = (label) => {
      if (this._protocols.swap[blockchain]?.[label]) {
        const { Protocol, config } = this._protocols.swap[blockchain][label]

        const protocol = new Protocol(account, config)

        return protocol
      }

      if (protocols.swap[label]) {
        return protocols.swap[label]
      }

      throw new Error(`No swap protocol registered for label: ${label}.`)
    }

    account.getBridgeProtocol = (label) => {
      if (this._protocols.bridge[blockchain]?.[label]) {
        const { Protocol, config } = this._protocols.bridge[blockchain][label]

        const protocol = new Protocol(account, config)

        return protocol
      }

      if (protocols.bridge[label]) {
        return protocols.bridge[label]
      }

      throw new Error(`No bridge protocol registered for label: ${label}.`)
    }

    account.getLendingProtocol = (label) => {
      if (this._protocols.lending[blockchain]?.[label]) {
        const { Protocol, config } = this._protocols.lending[blockchain][label]

        const protocol = new Protocol(account, config)

        return protocol
      }

      if (protocols.lending[label]) {
        return protocols.lending[label]
      }

      throw new Error(`No lending protocol registered for label: ${label}.`)
    }

    account.getFiatProtocol = (label) => {
      if (this._protocols.fiat[blockchain]?.[label]) {
        const { Protocol, config } = this._protocols.fiat[blockchain][label]

        const protocol = new Protocol(account, config)

        return protocol
      }

      if (protocols.fiat[label]) {
        return protocols.fiat[label]
      }

      throw new Error(`No fiat protocol registered for label: ${label}.`)
    }
  }
}
