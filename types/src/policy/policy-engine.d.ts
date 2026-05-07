export default class PolicyEngine {
    /** @private */
    private _registry;
    /** @private */
    private _conditionTimeoutMs;
    /**
     * Registers one or more policies. Synchronously throws on validation failures.
     *
     * @param {string | string[] | undefined} chain
     * @param {Policy | Policy[]} policies
     * @param {RegisterPolicyOptions} [options]
     */
    register(chain: string | string[] | undefined, policies: Policy | Policy[], options?: RegisterPolicyOptions): void;
    /**
     * Wraps the given account with policy enforcement.
     *
     * @param {object} account
     * @param {object} ctx
     * @param {string} ctx.blockchain
     * @param {string | undefined} ctx.path
     */
    applyPoliciesTo(account: object, { blockchain, path }: {
        blockchain: string;
        path: string | undefined;
    }): Promise<void>;
    /**
     * Removes wallet- and account-bound policies for the given chain.
     *
     * @param {string} chain
     */
    disposeChain(chain: string): void;
    /**
     * Removes all registered policies across every bucket.
     */
    disposeAll(): void;
    /** @private */
    private _relevantOperations;
    /** @private */
    private _evaluateContext;
    /** @private */
    private _simulateContext;
}
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type PolicyAction = "ALLOW" | "DENY";
export type PolicyScope = "project" | "wallet" | "account";
export type PolicyOperation = "sendTransaction" | "transfer" | "approve" | "signMessage" | "signHash" | "signTypedData" | "signAuthorization" | "delegate" | "revokeDelegation" | "swap" | "bridge" | "supply" | "withdraw" | "borrow" | "repay" | "buy" | "sell" | "*";
export type PolicyContext = {
    /**
     * - The intercepted operation name.
     */
    operation: PolicyOperation;
    /**
     * - The blockchain identifier.
     */
    chain: string;
    /**
     * - A read-only view of the wallet account.
     */
    account: IWalletAccountReadOnly;
    /**
     * - The first argument to the wrapped method.
     */
    params: unknown;
    /**
     * - The full argument array.
     */
    args: readonly unknown[];
};
export type PolicyCondition = (context: PolicyContext) => boolean | Promise<boolean>;
export type PolicyRule = {
    name: string;
    /**
     * - Optional human-readable explanation. When set on a DENY rule that matches, propagates to PolicyViolationError.reason and to the matching simulate-result. Defaults to the rule's name.
     */
    reason?: string;
    operation: PolicyOperation | PolicyOperation[];
    action: PolicyAction;
    /**
     * - When true on an account-scope ALLOW rule that matches, the rule's verdict short-circuits both wallet- and project-scope evaluation. Account-scope rules are evaluated in registration order; the first matching override-flag rule wins. Only valid on account-scope ALLOW rules.
     */
    override_broader_scope?: boolean;
    conditions: PolicyCondition[];
    /**
     * Reserved for Phase 2; ignored at runtime.
     */
    state?: object;
    /**
     * Reserved for Phase 2; ignored at runtime.
     */
    onSuccess?: (c: PolicyContext) => void | Promise<void>;
};
export type Policy = {
    id: string;
    name: string;
    scope: PolicyScope;
    /**
     * - Derivation paths the policy applies to (required when scope is 'account'). Exact-string matching only in Phase 1; no prefix or wildcard matching.
     */
    accounts?: string[];
    rules: PolicyRule[];
};
export type RegisterPolicyOptions = {
    /**
     * - Reserved for Phase 2.
     */
    state?: object;
    /**
     * - Per-condition evaluation timeout in milliseconds. Defaults to 30000. A condition that exceeds the timeout is treated the same as a throw — fail-closed for DENY rules, fail-open-as-no-match for ALLOW rules. Engine-wide; the most recent registerPolicy call's value wins.
     */
    conditionTimeoutMs?: number;
};
export type SimulationTraceEntry = {
    scope: PolicyScope;
    policy_id: string;
    rule_name: string;
    matched: boolean;
    error?: string;
};
export type SimulationResult = {
    decision: "ALLOW" | "DENY";
    policy_id: string | null;
    matched_rule: string | null;
    reason: string | null;
    trace: SimulationTraceEntry[];
};
