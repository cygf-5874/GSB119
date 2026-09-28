# mailthread

把一批邮件合并成**会话**（thread）。Node.js 22、ESM，只用 `node:` 内置模块，**零第三方依赖**。

- 入口：`src/thread.js`（导出 `groupMessages`）
- 选项层：`src/config.js`（`DEFAULT_SUBJECT_PREFIXES` / `DEFAULT_TIME_WINDOW_MS` / `normalizeOptions`，**已给全**）
- 既有用例：`test/thread.test.js`（13 个，当前全绿）
- 固定验收程序：`check/check.mjs`（**不要修改**）
- 自检：`bash scripts/check.sh`

```bash
node --test                    # 既有用例（仓库根目录裸跑）
node check/check.mjs           # 跑全部场景
node check/check.mjs -list     # 只列出 组/名
node check/check.mjs --only refs
bash scripts/check.sh --only window
```

---

## 数据模型

一封**邮件**：

```js
{
  subject: string,              // 主题原文，不做任何改写
  at: number,                   // 时间戳（毫秒）
  messageId?: string,           // 本封邮件的 Message-ID
  inReplyTo?: string,           // 本封邮件所回复的那封的 Message-ID
  references?: readonly string[] // 本封邮件的 References 链（祖先 Message-ID 列表）
}
```

`groupMessages(messages, options)` 返回 `Message[][]`：每个元素是一个会话（组内邮件的数组）。

## 期望输出

- **组内顺序**：按 `at` 升序；`at` 相同时按它们在入参里出现的先后。
- **组间顺序**：按「组内最早的 `at`」升序；并列时按「该组最早出现的那封邮件在入参里的下标」升序。
- 入参数组与其中的邮件对象**都不得被修改**。

---

## 对外契约（9 条）

1. 既有行为不得回归：在时间窗内，`subject` 完全相同的邮件仍归为一组
   （`test/thread.test.js` 覆盖的行为不受本次改动影响）。
2. **引用链**。若 A 的 `references` 含 B 的 `messageId`（或 A 的 `inReplyTo === B.messageId`），
   则 A 与 B **同组**；并沿链**传递**合并（A→B→C 三封要合成一组）。
3. **Subject 归一化**。去掉 `Options.subjectPrefixes` 里的前缀（**大小写不敏感**、**可组合**、
   **可重复**、**可带空格**），再做 `trim` 与**连续空白折叠**，然后比较是否相等。
4. **时间窗**。仅靠第 3 条匹配的两封邮件，时间差必须 `≤ Options.timeWindowMs` 才合并；
   超过则**不合并**。经过第 2 条（引用链）合并的不受时间窗限制。
5. 合并结果里的组顺序按**组内最早时间**升序；组内按时间升序。
6. **不可传递地误合并**：A~B（引用链）与 B~C（仅主题 + 时间窗）存在时，
   若 A~C 既无引用链也超时间窗，则最终仍是**一个组**（合并是**并查集**语义 —— 关系可传递）。
7. 环引用（A 引用 B、B 引用 A）不得死循环，必须终止。
8. `Options.now` 为**注入时钟**：所有「当前时间」一律取自它，**不得**调用 `Date.now()`。
9. 空输入返回 `[]`；单封邮件返回一个组；`messageId` 重复的邮件按同一封处理（去重）。

### 精确定义（保证判据确定、与实现无关）

- **前缀剥离**：反复做下面两步，直到前缀表不再命中为止：
  ① 跳过 subject 开头的空白（SP / HTAB）；② 若紧接着命中前缀表中的某一项（比较时大小写不敏感），
  就把它**连同紧随其后的空白**一起剥掉。剥离结束后 `trim`，再把内部的连续空白（SP / HTAB）
  折叠成单个空格。前缀表由 `Options.subjectPrefixes` 给出；**归一化不改变大小写**，
  所以 `Plan` 与 `plan` 仍是两个不同的主题。
- **主题匹配**：两封邮件的归一化主题**逐字符相等**即算「主题匹配」。**第 4 条的时间窗对所有主题匹配
  都生效**，包括 `subject` 字面完全相同的两封。
- **引用匹配**：把每封邮件的 `messageId` 建成索引；对每封邮件，其 `references` 里的每个 id 与
  `inReplyTo` 都算一条「引用边」。边的两端指向的是邮件（按 `messageId` 认），不是 `messageId` 字符串；
  引用表中不存在的 id 忽略。自引用 / 环引用只产生自环或环，合并必须终止。
- **去重**：`messageId` 相同的多封邮件视为同一封，只保留**在入参里最先出现**的那一封；
  没有 `messageId` 的邮件之间互不去重。
- **合并**：把「引用边」与「满足时间窗的主题匹配」当成无向边，取连通分量（并查集）。
- **默认值**：`Options.subjectPrefixes` 默认 `['Re:', 'RE:', 'Fwd:', 'FW:']`，
  `Options.timeWindowMs` 默认 `5 * 60 * 1000`，`Options.now` 默认 `() => 0`。
- 结果**不得依赖 `Map` / `Set` 的迭代顺序**：组间 / 组内顺序由上文的排序规则完全决定。

## 导出面

- `src/thread.js`：`groupMessages(messages, options)`。
- `src/config.js`：`DEFAULT_SUBJECT_PREFIXES`、`DEFAULT_TIME_WINDOW_MS`、`normalizeOptions(options)`。

## 本次要补的一层

**引用链（第 2 条）、主题归一化（第 3 条）、时间窗（第 4 条）、并查集传递（第 6 条）都还没有实现。**
`src/thread.js` 现在只按 `subject` 精确相等分组，`test/thread.test.js` 的 13 个用例因此全绿，
`check/check.mjs` 只过 3 个场景（subject 组的 1 个、window 组的 1 个、edge 的 1 个）。

`src/config.js` 里三个字段的含义已固定：`subjectPrefixes`（前缀表）、`timeWindowMs`（时间窗）、
`now`（注入时钟）。本层当前不需要「当前时间」，但实现里**不得**出现 `Date.now()`。

约束：不改 `check/`、不改 `src/config.js`、不改 `test/thread.test.js`；不引入第三方依赖，
`package.json` 里不许出现 `dependencies`；结果必须与 `Map` / `Set` 迭代顺序无关。
