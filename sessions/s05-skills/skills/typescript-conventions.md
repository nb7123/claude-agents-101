# TypeScript 编码规范

## 命名规范
- 变量/函数：camelCase（`getUserById`, `isActive`）
- 类/接口/类型：PascalCase（`UserService`, `ApiResponse`）
- 常量：SCREAMING_SNAKE_CASE（`MAX_RETRIES`, `API_BASE_URL`）
- 文件名：kebab-case（`user-service.ts`, `api-client.ts`）

## 类型使用
- 优先用 `interface` 定义对象结构，用 `type` 定义联合/交叉类型
- 避免 `any`，用 `unknown` 替代，再做类型收窄
- 函数返回值类型显式声明，参数类型必须声明
- 使用 `as const` 替代枚举

## 异步规范
- 统一用 `async/await`，不混用 `.then()` 链式调用
- 错误处理用 `try/catch`，不吞掉 error
- Promise 并发用 `Promise.all`，有依赖关系才串行

## 导入规范
- 使用 ESM `import/export`，不用 `require`
- 类型导入用 `import type { Foo }`
- 第三方包在前，内部模块在后，用空行分隔
