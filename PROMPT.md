手上有一批真实邮件，同一主题的散成了七八个会话。mailthread 是 Node.js 22 的
邮件会话合并库，只用 `node:` 内置模块（无第三方依赖），构建不需要额外步骤，
自检走 `scripts/check.sh`（`check/` 是固定验收程序，别改），既有用例走 `node --test`。

现在只会按 subject 完全相等分组，`Options` 里已经预留了前缀表、时间窗和注入时钟三个字段。

任务：按 README「本次要补的一层」把引用链、主题归一化、时间窗做出来，让固定件全过。

验收：
- node --test 全绿；
- node check/check.mjs 退出码 0，9 个场景全过（subject 2 + refs 3 + window 2 + union 1 + edge 1）。

约束：
1. 不改 `check/`、不改 `src/config.js` 的字段含义；可以新增模块。
2. 对外导出名与签名不许改；`test/thread.test.js` 里的既有用例一条都不许删或改。
3. 只用 `node:` 内置模块，`package.json` 里不许出现 `dependencies`。
4. 当前时间只能从 `Options.now` 取，不许调用 `Date.now()`。
