/**
 * 主题归一化（见 README「精确定义」）。
 *
 * 反复执行：① 跳过开头的 SP / HTAB；② 若紧接着命中前缀表中的某一项
 * （大小写不敏感），就把前缀连同紧随其后的 SP / HTAB 一起剥掉；
 * 直到前缀表不再命中。最后做 trim，并把内部连续的 SP / HTAB 折叠成单个空格。
 * 归一化保留原大小写（"Plan" 与 "plan" 仍不同）。
 */

const LEADING_WS = /^[ \t]+/;
const INNER_WS = /[ \t]+/g;

/**
 * @param {string} subject 主题原文
 * @param {readonly string[]} prefixes 前缀表（原样保留大小写，比较时不敏感）
 * @returns {string}
 */
export function normalizeSubject(subject, prefixes) {
  const lowered = prefixes.map((prefix) => [prefix, prefix.toLowerCase()]);

  let rest = subject;
  for (;;) {
    const lead = rest.replace(LEADING_WS, '');
    let matched = null;
    for (const [prefix, lower] of lowered) {
      if (
        lead.length >= prefix.length &&
        lead.slice(0, prefix.length).toLowerCase() === lower
      ) {
        matched = prefix;
        break;
      }
    }
    if (matched === null) {
      break;
    }
    rest = lead.slice(matched.length).replace(LEADING_WS, '');
  }

  return rest.trim().replace(INNER_WS, ' ');
}
