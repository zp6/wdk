/**
 * @internal
 *
 * In-memory store for registered policies, partitioned into two buckets:
 *   - `_project`                  project-scope policies, ordered list, indexed by id.
 *   - `_accountByWallet[wallet]`  account-scope policies bound to that wallet
 *                                 identifier (matching against `policy.accounts`
 *                                 entries — paths or indexes — is done at
 *                                 evaluation time).
 *
 * Same-id-within-same-bucket replaces in place, preserving registration order.
 * Different bindings (same id under wallet A vs wallet B vs project) are
 * independent records.
 */
export default class PolicyRegistry {
    /** @private */
    private _project;
    /** @private */
    private _accountByWallet;
    /**
     * Registers a single policy under the given wallet bindings.
     * - For a project-scope policy: wallets === undefined applies it globally;
     *   a wallet array narrows the policy to those wallets only.
     * - For an account-scope policy: wallets is required and binds the policy
     *   into the per-wallet account bucket.
     *
     * Stores a defensive deep-ish clone of the policy so callers cannot mutate
     * engine state by editing the original object after registration.
     *
     * @param {object} policy
     * @param {string[] | undefined} wallets
     */
    add(policy: object, wallets: string[] | undefined): void;
    /**
     * Returns the policies that may apply to a given (wallet, path, index) call,
     * partitioned into the two groups (account, project). An account-scope
     * policy matches when `policy.accounts` contains the path (string match)
     * or the index (number match). A project-scope policy matches when it
     * has no wallet restriction or its restriction includes the wallet.
     *
     * @param {string} wallet
     * @param {string | undefined} path
     * @param {number | undefined} index
     * @returns {{ account: object[], project: object[] }}
     */
    applicable(wallet: string, path: string | undefined, index: number | undefined): {
        account: object[];
        project: object[];
    };
    /**
     * Returns every policy that's potentially relevant to a given (wallet, path, index),
     * regardless of scope. Used to compute the operation-name set the wrapper
     * needs to handle.
     *
     * @param {string} wallet
     * @param {string | undefined} path
     * @param {number | undefined} index
     * @returns {object[]}
     */
    relevant(wallet: string, path: string | undefined, index: number | undefined): object[];
    /**
     * Removes every binding of this wallet from the registry:
     * - account-scope policies bound to the wallet are dropped entirely.
     * - project-scope policies that included this wallet in their restriction
     *   are narrowed to the remaining wallets; if no wallets are left, the
     *   policy is removed entirely.
     * - global (unrestricted) project-scope policies are untouched.
     *
     * @param {string} wallet
     */
    disposeWallet(wallet: string): void;
    /**
     * Removes every registered policy across both buckets.
     */
    disposeAll(): void;
}
