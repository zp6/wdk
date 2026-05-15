# WDK Security Guard Middleware

A WDK middleware that scans transactions for security risks before signing.

## Features

- Detects unlimited ERC-20 approvals (`type(uint256).max`)
- Flags `setApprovalForAll` calls (high risk)
- Warns about suspicious contract interactions
- Configurable risk thresholds

## Installation

```bash
npm install @tetherto/wdk-security-guard
```

## Usage

```typescript
import { createSecurityGuard } from '@tetherto/wdk-security-guard';

const guard = createSecurityGuard({
  maxApprovalThreshold: '1000000000000000000000000', // 1000 tokens
  blockSetApprovalForAll: true,
  warnOnUnknownContracts: true,
});

// Apply to WDK instance
wdk.use(guard);
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxApprovalThreshold` | `string` | `'1000000'` | Max token approval before warning |
| `blockSetApprovalForAll` | `boolean` | `true` | Block all setApprovalForAll calls |
| `warnOnUnknownContracts` | `boolean` | `true` | Warn on unverified contracts |
| `customChecks` | `Function[]` | `[]` | Custom security check functions |

## Custom Checks

```typescript
const guard = createSecurityGuard({
  customChecks: [
    (tx) => {
      // Custom logic here
      return { safe: true, reason: '' };
    }
  ]
});
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
