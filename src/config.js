/**
 * mailthread 的调用选项。
 *
 * 本文件**已给全**：字段含义固定，不需要（也不应该）改动。
 *
 * @typedef {object} Options
 * @property {readonly string[]} [subjectPrefixes] 主题前缀表，**大小写不敏感**。
 * @property {number} [timeWindowMs] 仅靠主题匹配的两封邮件允许的最大时间差（毫秒）。
 * @property {() => number} [now] 注入时钟；「当前时间」只能从这里取。
 */

/** 默认的主题前缀表（大小写不敏感，可组合、可重复）。 */
export const DEFAULT_SUBJECT_PREFIXES = Object.freeze(['Re:', 'RE:', 'Fwd:', 'FW:']);

/** 默认时间窗：5 分钟。 */
export const DEFAULT_TIME_WINDOW_MS = 5 * 60 * 1000;

/**
 * 把调用方传入的选项补齐默认值并做类型校验。
 *
 * @param {Options} [options]
 * @returns {{subjectPrefixes: readonly string[], timeWindowMs: number, now: () => number}}
 */
export function normalizeOptions(options) {
  const o = options === undefined || options === null ? {} : options;

  const subjectPrefixes = o.subjectPrefixes === undefined ? DEFAULT_SUBJECT_PREFIXES : o.subjectPrefixes;
  if (!Array.isArray(subjectPrefixes)) {
    throw new TypeError('subjectPrefixes must be an array of strings');
  }
  for (const p of subjectPrefixes) {
    if (typeof p !== 'string' || p.length === 0) {
      throw new TypeError('subjectPrefixes entries must be non-empty strings');
    }
  }

  const timeWindowMs = o.timeWindowMs === undefined ? DEFAULT_TIME_WINDOW_MS : o.timeWindowMs;
  if (typeof timeWindowMs !== 'number' || Number.isNaN(timeWindowMs)) {
    throw new TypeError('timeWindowMs must be a number');
  }

  const now = o.now === undefined ? () => 0 : o.now;
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }

  return { subjectPrefixes, timeWindowMs, now };
}
