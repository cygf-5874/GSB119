/**
 * mailthread —— 把邮件按会话分组。
 *
 * 对外契约见仓库根目录的 README.md。
 * 当前实现只做了**主题精确相等**这一层：`subject` 完全相同（逐字符相同）的邮件归为一组。
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
export function groupMessages(messages, options) {
  if (!Array.isArray(messages)) {
    throw new TypeError('messages must be an array');
  }

  // 当前只按 subject 精确相等分组；首次出现的顺序用输入下标固定下来，
  // 结果不依赖 Map 的迭代顺序。
  const buckets = new Map();
  const firstSeen = new Map();
  messages.forEach((message, index) => {
    const key = message.subject;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      firstSeen.set(key, index);
    }
    buckets.get(key).push(message);
  });

  const groups = [];
  for (const [key, members] of buckets) {
    const sorted = members.slice().sort((a, b) => a.at - b.at);
    groups.push({ members: sorted, earliest: sorted[0].at, first: firstSeen.get(key) });
  }
  groups.sort((a, b) => a.earliest - b.earliest || a.first - b.first);

  return groups.map((group) => group.members);
}
