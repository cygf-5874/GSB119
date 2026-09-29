import { normalizeOptions } from './config.js';

/**
 * mailthread —— 把邮件按会话分组。
 *
 * 对外契约见仓库根目录的 README.md。
 *
 * @typedef {object} Message
 * @property {string} subject 主题（原文，不做任何改写）
 * @property {number} at 邮件时间戳（毫秒）
 * @property {string} [messageId] 本封邮件的 Message-ID
 * @property {string} [inReplyTo] 本封邮件回复的那封的 Message-ID
 * @property {readonly string[]} [references] 本封邮件的 References 链
 */

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }

    let current = index;
    while (this.parent[current] !== current) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }

    return root;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent[rightRoot] = leftRoot;
    }
  }
}

function normalizeSubject(subject, subjectPrefixes) {
  let value = subject;

  for (;;) {
    let offset = 0;
    while (
      offset < value.length &&
      (value.charCodeAt(offset) === 32 || value.charCodeAt(offset) === 9)
    ) {
      offset += 1;
    }

    const candidate = value.slice(offset);
    const prefix = subjectPrefixes.find((item) =>
      candidate.toLowerCase().startsWith(item.toLowerCase()),
    );

    if (prefix === undefined) {
      break;
    }

    value = candidate.slice(prefix.length).replace(/^[ \t]+/, '');
  }

  return value
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .replace(/[ \t]+/g, ' ');
}

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

  const { subjectPrefixes, timeWindowMs } = normalizeOptions(options);

  const uniqueMessages = [];
  const originalIndexes = [];
  const normalizedSubjects = [];
  const messageIdIndex = new Map();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.messageId !== undefined && messageIdIndex.has(message.messageId)) {
      continue;
    }

    const uniqueIndex = uniqueMessages.length;
    if (message.messageId !== undefined) {
      messageIdIndex.set(message.messageId, uniqueIndex);
    }

    uniqueMessages.push(message);
    originalIndexes.push(index);
    normalizedSubjects.push(normalizeSubject(message.subject, subjectPrefixes));
  }

  const unions = new UnionFind(uniqueMessages.length);

  for (let index = 0; index < uniqueMessages.length; index += 1) {
    const message = uniqueMessages[index];

    if (message.inReplyTo !== undefined && messageIdIndex.has(message.inReplyTo)) {
      unions.union(index, messageIdIndex.get(message.inReplyTo));
    }

    if (Array.isArray(message.references)) {
      for (const referenceId of message.references) {
        if (messageIdIndex.has(referenceId)) {
          unions.union(index, messageIdIndex.get(referenceId));
        }
      }
    }
  }

  const subjectBuckets = new Map();
  for (let index = 0; index < uniqueMessages.length; index += 1) {
    const key = normalizedSubjects[index];
    if (!subjectBuckets.has(key)) {
      subjectBuckets.set(key, []);
    }
    subjectBuckets.get(key).push(index);
  }

  for (const bucket of subjectBuckets.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const leftIndex = bucket[left];
        const rightIndex = bucket[right];
        const timeDifference = Math.abs(
          uniqueMessages[leftIndex].at - uniqueMessages[rightIndex].at,
        );

        if (timeDifference <= timeWindowMs) {
          unions.union(leftIndex, rightIndex);
        }
      }
    }
  }

  const groupsByRoot = new Map();
  for (let index = 0; index < uniqueMessages.length; index += 1) {
    const root = unions.find(index);
    if (!groupsByRoot.has(root)) {
      groupsByRoot.set(root, []);
    }
    groupsByRoot.get(root).push(index);
  }

  const groups = [];
  for (const memberIndexes of groupsByRoot.values()) {
    memberIndexes.sort(
      (left, right) =>
        uniqueMessages[left].at - uniqueMessages[right].at ||
        originalIndexes[left] - originalIndexes[right],
    );

    const firstIndex = memberIndexes[0];
    groups.push({
      members: memberIndexes.map((index) => uniqueMessages[index]),
      earliest: uniqueMessages[firstIndex].at,
      first: originalIndexes[firstIndex],
    });
  }

  groups.sort((left, right) => left.earliest - right.earliest || left.first - right.first);

  return groups.map((group) => group.members);
}
