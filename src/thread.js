/**
 * mailthread —— 把邮件按会话分组。
 *
 * 对外契约见仓库根目录的 README.md。
 * 合并依据（取无向边的连通分量，即并查集语义）：
 *   - 引用边：`references` 中的每个 id 与 `inReplyTo` 命中其他邮件的 `messageId`
 *     （不受时间窗限制，沿链传递）；
 *   - 主题边：归一化主题相等且时间差 ≤ `timeWindowMs`。
 * 相同 `messageId` 的邮件按入参最先出现的一封去重。
 *
 * @typedef {object} Message
 * @property {string} subject 主题（原文，不做任何改写）
 * @property {number} at 邮件时间戳（毫秒）
 * @property {string} [messageId] 本封邮件的 Message-ID
 * @property {string} [inReplyTo] 本封邮件回复的那封的 Message-ID
 * @property {readonly string[]} [references] 本封邮件的 References 链
 */

/**
 * 把一批邮件分组成会话。
 *
 * @param {readonly Message[]} messages
 * @param {object} [options] 见 `src/config.js`
 * @returns {Message[][]} 组内按时间升序；组间按组内最早时间升序
 */
import { normalizeOptions } from './config.js';
import { normalizeSubject } from './normalize.js';
import { UnionFind } from './dsu.js';

export function groupMessages(messages, options) {
  if (!Array.isArray(messages)) {
    throw new TypeError('messages must be an array');
  }
  if (messages.length === 0) {
    return [];
  }

  const { subjectPrefixes, timeWindowMs } = normalizeOptions(options);

  // 去重：相同 messageId 只保留入参里最先出现的一封；
  // 没有 messageId 的邮件之间互不去重。
  const members = [];
  const indexById = new Map();
  messages.forEach((message, originalIndex) => {
    if (message.messageId !== undefined) {
      if (indexById.has(message.messageId)) {
        return;
      }
      indexById.set(message.messageId, members.length);
    }
    members.push({ message, originalIndex });
  });

  const uf = new UnionFind(members.length);

  // 引用边（不受时间窗限制；悬空 id 与自引用自然忽略或只产生自环）。
  members.forEach(({ message }, i) => {
    if (message.inReplyTo !== undefined) {
      const j = indexById.get(message.inReplyTo);
      if (j !== undefined) {
        uf.union(i, j);
      }
    }
    const references = message.references;
    if (Array.isArray(references)) {
      for (const id of references) {
        const j = indexById.get(id);
        if (j !== undefined) {
          uf.union(i, j);
        }
      }
    }
  });

  // 主题边：归一化主题相等且时间差 ≤ timeWindowMs（主题精确相同也受时间窗约束）。
  const bySubject = new Map();
  members.forEach(({ message, originalIndex }, i) => {
    const key = normalizeSubject(message.subject, subjectPrefixes);
    if (!bySubject.has(key)) {
      bySubject.set(key, []);
    }
    bySubject.get(key).push(i);
  });
  for (const indices of bySubject.values()) {
    for (let p = 0; p < indices.length; p += 1) {
      for (let q = p + 1; q < indices.length; q += 1) {
        const a = indices[p];
        const b = indices[q];
        if (Math.abs(members[a].message.at - members[b].message.at) <= timeWindowMs) {
          uf.union(a, b);
        }
      }
    }
  }

  // 按连通分量收集；下标按输入顺序遍历，不依赖 Map / Set 迭代顺序。
  const componentByRoot = new Map();
  const components = [];
  members.forEach((entry, i) => {
    const root = uf.find(i);
    let component = componentByRoot.get(root);
    if (component === undefined) {
      component = [];
      componentByRoot.set(root, component);
      components.push(component);
    }
    component.push(entry);
  });

  const groups = [];
  for (const component of components) {
    const sorted = component
      .slice()
      .sort(
        (a, b) =>
          a.message.at - b.message.at || a.originalIndex - b.originalIndex,
      );
    groups.push({
      members: sorted.map((entry) => entry.message),
      earliest: sorted[0].message.at,
      first: sorted.reduce((min, entry) => Math.min(min, entry.originalIndex), Infinity),
    });
  }
  groups.sort((a, b) => a.earliest - b.earliest || a.first - b.first);

  return groups.map((group) => group.members);
}
