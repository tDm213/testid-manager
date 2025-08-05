# testid-manager

A CLI tool to automatically manage, clean, and compare unique test IDs in your `it()` or `test()` blocks.

---

## 📦 Installation

Install it locally or globally:

```bash
npm install testid-manager
```

## 🚀 Commands:
### 1. add
Adds incremental test IDs to all test blocks.

✅ Example
```bash
npx testid-manager add baseId=e2e-001 files="tests/**/*.ts" overwrite
```
| Option      | Description                                                 |
| ----------- | ----------------------------------------------------------- |
| `baseId`    | The starting ID, must end with a number. Example: `e2e-001` |
| `files`     | Glob pattern for matching test files `js/ts`                      |
| `overwrite` | Optional flag to overwrite existing IDs                     |

### 2. clean
Removes all test IDs that match the baseId pattern.

✅ Example
```bash
npx testid-manager clean baseId=e2e-001 files="tests/**/*.ts"
```
| Option   | Description                                |
| -------- | ------------------------------------------ |
| `baseId` | The ID prefix to match. Example: `e2e-001` |
| `files`  | Glob pattern for matching test files       |


### 3. compare
Finds:
 Missing and Duplicate IDs

✅ Example
```bash
npx testid-manager compare baseId=e2e-001 files="tests/**/*.ts"
```
| Option   | Description                                |
| -------- | ------------------------------------------ |
| `baseId` | The ID prefix to match. Example: `e2e-001` |
| `files`  | Glob pattern for matching test files       |


🧪 Output Example
```yaml
🔍 Found 7 total IDs

📛 Duplicate IDs: e2e-003, e2e-005

🚫 Missing IDs: e2e-004, e2e-006
```
🔧 How IDs Work

- baseId must end in a number (e.g., e2e-001, T1000)
- The number is auto-incremented (e.g., e2e-001, e2e-002, e2e-003)
- The full ID is added before the test description:

```js
it("e2e-002: should submit the form", () => { ... });
```
🛡️ Use Cases

- Ensure unique, consistent test IDs
- Track test coverage with external tools
- Prevent duplicated or missing test identifiers

🧪 Supported Syntax

Works with:

JavaScript & TypeScript ```it() / test()``` syntax

✍️ Author
Made by @tDm213