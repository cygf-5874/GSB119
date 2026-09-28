#!/usr/bin/env node
/**
 * mailthread 固定验收程序（固定件）。
 *
 * 用法（在仓库根目录）：
 *   node check/check.mjs            跑全部场景
 *   node check/check.mjs -list      只列出 `组/名`
 *   node check/check.mjs --only <组>  只跑某一组
 *
 * 输出：逐场景 `PASS <组>/<名>` 或 `FAIL <组>/<名>  期望=… 实际=…`，
 * 结尾 `结果：通过 x/N`；全过 exit 0，否则 exit 1；失败不早退。
 *
 * 判据只描述**对外可见性质**（分组结果、组的划分与顺序、组内的顺序、是否调用墙钟），
 * 不引用任何内部实现细节。本文件不含任何分组实现，测试向量全部写死在场景表里。
 */
import { groupMessages } from '../src/thread.js';

/* ------------------------------------------------------------------ 工具 */

const fail = (msg) => {
  throw new Error(msg);
};

/** 把结果压成「每组的 at 序列」，便于逐场景比较。 */
const shape = (groups) => groups.map((g) => g.map((m) => m.at));

const eq = (actual, expected, label) => {
  if (actual !== expected) fail(`${label}：期望 ${String(expected)}，实际 ${String(actual)}`);
};

const eqShape = (groups, expected, label) => {
  if (!Array.isArray(groups)) fail(`${label}：期望返回数组，实际 ${describe(groups)}`);
  const got = shape(groups);
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${label}：期望分组 ${b}，实际 ${a}`);
};

const eqSubjects = (groups, expected, label) => {
  const got = groups.map((g) => g.map((m) => m.subject));
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${label}：期望 ${b}，实际 ${a}`);
};

const describe = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') return `object ${JSON.stringify(v)}`;
  return `${typeof v} ${String(v)}`;
};

const call = (messages, options) => {
  const groups = groupMessages(messages, options);
  if (!Array.isArray(groups)) fail(`groupMessages 期望返回数组，实际 ${describe(groups)}`);
  for (const g of groups) {
    if (!Array.isArray(g)) fail(`每个分组期望是数组，实际 ${describe(g)}`);
  }
  return groups;
};

/** 在「调用 Date.now() 就抛错」的窗口里跑一段逻辑，用来核对注入时钟契约。 */
function withoutWallClock(fn) {
  const original = Date.now;
  Date.now = () => {
    throw new Error('不得调用 Date.now()：本层不使用墙钟');
  };
  try {
    return fn();
  } finally {
    Date.now = original;
  }
}

/* -------------------------------------------------------------- 测试向量 */

const mail = (subject, at, extra = {}) => ({ subject, at, ...extra });

/* ---------------------------------------------------------------- 场景表 */

const scenarios = [
  {
    group: 'subject',
    name: '精确相等不回归',
    expect:
      '两封 subject 完全相同（"Deploy freeze"）+ 一封别的主题 → 两组：[[1000,4000],[5000]]，组间按最早时间、组内按时间',
    run() {
      const groups = call([
        mail('Deploy freeze', 1000),
        mail('Team lunch', 5000),
        mail('Deploy freeze', 4000),
      ]);
      eqShape(groups, [[1000, 4000], [5000]], 'subject 精确相等的分组');
      eqSubjects(groups, [['Deploy freeze', 'Deploy freeze'], ['Team lunch']], '各组的 subject');
    },
  },
  {
    group: 'subject',
    name: '前缀归一化',
    expect:
      '默认前缀表下，Re: / RE: / Fwd: / FW: 可组合可重复、大小写不敏感、前后与内部空白都归一，5 封合成一组；前缀表换成 ["AW:"] 后只有 AW: 被剥离，"Re: Budget" 与 "Budget" 分成两组',
    run() {
      const groups = call([
        mail('Re: Release plan', 0),
        mail('RE:   Release plan', 1000),
        mail('Fwd: Fw: Release plan', 2000),
        mail('Release plan', 3000),
        mail('Release   plan', 4000),
      ]);
      eqShape(groups, [[0, 1000, 2000, 3000, 4000]], '默认前缀表下的分组');

      const custom = call(
        [mail('AW: Budget', 0), mail('Budget', 500), mail('Re: Budget', 1000)],
        { subjectPrefixes: ['AW:'] },
      );
      eqShape(custom, [[0, 500], [1000]], '自定义前缀表下的分组');
      eqSubjects(custom, [['AW: Budget', 'Budget'], ['Re: Budget']], '自定义前缀表下各组的 subject');
    },
  },

  {
    group: 'refs',
    name: 'references链传递',
    expect:
      'A(messageId=a) ← B(references=[a]) ← C(references=[b])，三封 subject 各不相同 → 一个组 [0,100,200]（沿链传递）',
    run() {
      const groups = call([
        mail('Alpha', 0, { messageId: 'a' }),
        mail('Beta', 100, { messageId: 'b', references: ['a'] }),
        mail('Gamma', 200, { messageId: 'c', references: ['b'] }),
      ]);
      eqShape(groups, [[0, 100, 200]], 'references 链的分组');

      // 去掉 C 的引用后必须散成 [A,B] 与 [C] 两组。
      const noChain = call([
        mail('Alpha', 0, { messageId: 'a' }),
        mail('Beta', 100, { messageId: 'b', references: ['a'] }),
        mail('Gamma', 200, { messageId: 'c' }),
      ]);
      eqShape(noChain, [[0, 100], [200]], '断链后的分组');
    },
  },
  {
    group: 'refs',
    name: 'inReplyTo与环引用',
    expect:
      'inReplyTo 构成引用边；X↔Y 互指（环）必须终止并合成一组；指向不存在的 messageId 被忽略（Z 自成一组）→ [[0,5000],[10]]',
    run() {
      const groups = call([
        mail('X topic', 0, { messageId: 'x', inReplyTo: 'y' }),
        mail('Y topic', 5000, { messageId: 'y', inReplyTo: 'x' }),
        mail('Z topic', 10, { messageId: 'z', inReplyTo: 'nope' }),
      ]);
      eqShape(groups, [[0, 5000], [10]], '环引用与悬空引用');
      eqSubjects(groups, [['X topic', 'Y topic'], ['Z topic']], '环引用场景各组的 subject');
    },
  },
  {
    group: 'refs',
    name: '引用链不受时间窗限制',
    expect:
      'timeWindowMs=1000 时：相隔 1 小时但有引用边的两封合成一组；同样相隔 1 小时、主题相同但无引用边的两封必须分成两组',
    run() {
      const linked = call(
        [
          mail('A topic', 0, { messageId: 'a' }),
          mail('B topic', 3_600_000, { messageId: 'b', references: ['a'] }),
        ],
        { timeWindowMs: 1000 },
      );
      eqShape(linked, [[0, 3_600_000]], '引用链跨时间窗');

      const unlinked = call([mail('Same topic', 0), mail('Same topic', 3_600_000)], {
        timeWindowMs: 1000,
      });
      eqShape(unlinked, [[0], [3_600_000]], '同样间隔但只靠主题匹配的两封');
    },
  },

  {
    group: 'window',
    name: '窗口内合并',
    expect:
      '同一主题的三封在 0 / 4000 / 8000，timeWindowMs=5000 → 一个组 [0,4000,8000]（相邻两两在窗内，关系可传递）；期间调用 Date.now() 必须抛错',
    run() {
      const groups = withoutWallClock(() =>
        call([mail('Plan', 0), mail('Plan', 4000), mail('Plan', 8000)], { timeWindowMs: 5000 }),
      );
      eqShape(groups, [[0, 4000, 8000]], '窗口内的链式合并');
    },
  },
  {
    group: 'window',
    name: '窗口外不合并',
    expect:
      '同一主题的三封在 0 / 60000 / 61000，timeWindowMs=5000 → 分成 [[0],[60000,61000]]：超窗的一对不许合并',
    run() {
      const groups = call(
        [mail('Plan', 0), mail('Plan', 60000), mail('Plan', 61000)],
        { timeWindowMs: 5000 },
      );
      eqShape(groups, [[0], [60000, 61000]], '窗口外的分组');
    },
  },

  {
    group: 'union',
    name: '并查集传递与去重',
    expect:
      'A←B（引用链，无时间限制）与 B~C（同主题 "Beta"、Δ=2000≤5000）存在时，A 与 C 虽既无引用也超窗，最终仍是一个组；重复 messageId=a 的邮件去重，结果恰为 [0,10000,12000] 三封',
    run() {
      const groups = call(
        [
          mail('Alpha', 0, { messageId: 'a' }),
          mail('Beta', 10000, { messageId: 'b', references: ['a'] }),
          mail('Beta', 12000),
          mail('Alpha', 0, { messageId: 'a' }),
        ],
        { timeWindowMs: 5000 },
      );
      eqShape(groups, [[0, 10000, 12000]], '并查集传递 + 去重后的分组');
      eq(groups.length, 1, '组数');
      eq(groups[0].length, 3, '唯一一组的邮件数（重复 messageId 已去重）');
    },
  },

  {
    group: 'edge',
    name: '空输入与单封',
    expect: '空数组返回 []（options 省略或给 {} 都一样）；单封邮件返回恰好一个组，且组内就是那封邮件',
    run() {
      eqShape(call([]), [], '空输入（无 options）');
      eqShape(call([], {}), [], '空输入（给 {}）');

      const only = mail('Solo', 42, { messageId: 's' });
      const groups = call([only]);
      eq(groups.length, 1, '单封邮件的组数');
      eq(groups[0].length, 1, '单封邮件组内的邮件数');
      eq(groups[0][0].subject, 'Solo', '单封邮件的 subject');
      eq(groups[0][0].at, 42, '单封邮件的 at');
    },
  },
];

/* ---------------------------------------------------------------- 运行器 */

const argv = process.argv.slice(2);

if (argv.includes('-list')) {
  for (const s of scenarios) process.stdout.write(`${s.group}/${s.name}\n`);
  process.exit(0);
}

let only = null;
const onlyAt = argv.indexOf('--only');
if (onlyAt >= 0) {
  only = argv[onlyAt + 1];
  if (only === undefined) {
    process.stdout.write(
      '用法：node check/check.mjs --only <组名>（组名：subject / refs / window / union / edge）\n',
    );
    process.exit(1);
  }
}

const selected = only === null ? scenarios.slice() : scenarios.filter((s) => s.group === only);

if (selected.length === 0) {
  process.stdout.write(`结果：通过 0/0（没有匹配的场景：--only ${String(only)}）\n`);
  process.exit(1);
}

let passed = 0;
for (const s of selected) {
  const id = `${s.group}/${s.name}`;
  try {
    s.run();
    passed += 1;
    process.stdout.write(`PASS ${id}\n`);
  } catch (e) {
    const actual = e instanceof Error ? e.message : String(e);
    process.stdout.write(`FAIL ${id}  期望=${s.expect} 实际=${actual}\n`);
  }
}

process.stdout.write(`结果：通过 ${passed}/${selected.length}\n`);
process.exit(passed === selected.length ? 0 : 1);
