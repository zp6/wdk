/**
 * Normalises the wallet field of a policy into an array of non-empty strings
 * or `undefined` (meaning "apply to every registered wallet").
 *
 * @internal
 * @param {string | string[] | undefined} wallet
 * @param {string} policyId - The owning policy's id, used to build error messages.
 * @returns {string[] | undefined}
 */
export function normalisePolicyWallet(wallet: string | string[] | undefined, policyId: string): string[] | undefined;
/**
 * Validates a registerPolicy options bag (currently only `state`, reserved for Phase 2).
 *
 * @internal
 * @param {object | undefined} options
 */
export function validateRegisterOptions(options: object | undefined): void;
/**
 * Validates a single policy object and returns the normalised wallet binding.
 * Throws synchronously on the first failure.
 *
 * @internal
 * @param {object} policy - The policy to validate.
 * @returns {string[] | undefined} The normalised wallet binding, or undefined for "all wallets".
 */
export function validatePolicy(policy: object): string[] | undefined;
/**
 * Returns true if the given rule addresses the supplied operation.
 *
 * @internal
 * @param {object} rule
 * @param {string} operation
 * @returns {boolean}
 */
export function ruleAddressesOperation(rule: object, operation: string): boolean;
/**
 * Returns the union of operation names referenced by the given policies.
 * If any rule uses the wildcard, the result includes the full operation set.
 *
 * @internal
 * @param {Iterable<object>} policies
 * @returns {Set<string>}
 */
export function collectReferencedOperations(policies: Iterable<object>): Set<string>;
