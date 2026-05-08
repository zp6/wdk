/**
 * Returns the singleton policy context store. Always resolves to a usable
 * store — never null, never throws.
 *
 * @internal
 * @returns {Promise<{ run: (value: unknown, fn: () => unknown) => unknown, getStore: () => unknown }>}
 */
export function getPolicyContextStore(): Promise<{
    run: (value: unknown, fn: () => unknown) => unknown;
    getStore: () => unknown;
}>;
/**
 * Resets the cached store. Test-only; never call from production code.
 *
 * @internal
 */
export function _resetPolicyContextStore(): void;
/**
 * Builds the no-op fallback store used on runtimes without
 * `AsyncLocalStorage`. The store reports "no active context" for every
 * call, which means nested-call escape is disabled — every wrapped
 * method call evaluates independently. See the file header for details.
 *
 * @internal
 */
export function createFallbackStore(): {
    run(_value: any, fn: any): any;
    getStore(): any;
};
