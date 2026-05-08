/**
 * Wraps every write method on the given account that's referenced by a
 * registered policy, plus the four protocol getters so protocols returned
 * by them have their write methods wrapped too. Also attaches an
 * `account.simulate.*` mirror that runs evaluation without execution.
 *
 * If no registered policy applies to (wallet, path, index), this is a no-op.
 *
 * @internal
 * @param {IWalletAccount} account - The runtime account instance to mutate.
 * @param {object} options
 * @param {string} options.blockchain
 * @param {string | undefined} options.path
 * @param {number | undefined} options.index
 * @param {object} options.engine - The PolicyEngine instance.
 */
export function applyPoliciesToAccount(account: IWalletAccount, { blockchain, path, index, engine }: {
    blockchain: string;
    path: string | undefined;
    index: number | undefined;
    engine: object;
}): Promise<void>;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
