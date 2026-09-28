import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupMessages } from '../src/thread.js';

/** 造一封邮件。 */
const msg = (subject, at, extra = {}) => ({ subject, at, ...extra });

test('groupMessages：空输入返回空数组', () => {
  assert.deepEqual(groupMessages([]), []);
});

test('groupMessages：单封邮件返回一个组', () => {
  const m = msg('Hello', 100);
  const out = groupMessages([m]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], [m]);
});

test('groupMessages：subject 完全相同的两封归为一组', () => {
  const a = msg('Deploy freeze', 1000);
  const b = msg('Deploy freeze', 2000);
  const out = groupMessages([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
});

test('groupMessages：subject 不同的两封分成两组', () => {
  const a = msg('Deploy freeze', 1000);
  const b = msg('Team lunch', 2000);
  const out = groupMessages([a, b]);
  assert.equal(out.length, 2);
});

test('groupMessages：三封同 subject 归为一组', () => {
  const out = groupMessages([msg('Sync', 300), msg('Sync', 100), msg('Sync', 200)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 3);
});

test('groupMessages：组内按时间升序', () => {
  const out = groupMessages([msg('Sync', 300), msg('Sync', 100), msg('Sync', 200)]);
  assert.deepEqual(out[0].map((m) => m.at), [100, 200, 300]);
});

test('groupMessages：组间按组内最早时间升序', () => {
  const a = msg('B', 100);
  const b = msg('A', 500);
  const c = msg('B', 200);
  const out = groupMessages([a, b, c]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].map((m) => m.at), [100, 200]);
  assert.deepEqual(out[1].map((m) => m.at), [500]);
  assert.equal(out[0][0].subject, 'B');
  assert.equal(out[1][0].subject, 'A');
});

test('groupMessages：不修改入参数组的长度与顺序', () => {
  const messages = [msg('A', 3), msg('B', 1), msg('A', 2)];
  const snapshot = messages.slice();
  groupMessages(messages);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages, snapshot);
});

test('groupMessages：不修改入参的邮件对象', () => {
  const m = msg('A', 1, { messageId: 'x' });
  const before = JSON.stringify(m);
  const out = groupMessages([m]);
  assert.equal(JSON.stringify(m), before);
  assert.deepEqual(out, [[m]]);
});

test('groupMessages：空 subject 的两封归为一组', () => {
  const out = groupMessages([msg('', 1), msg('', 2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
});

test('groupMessages：subject 仅大小写不同视为不同的组', () => {
  const out = groupMessages([msg('Plan', 1), msg('plan', 2)]);
  assert.equal(out.length, 2);
});

test('groupMessages：不传 options 也能用', () => {
  const out = groupMessages([msg('A', 1), msg('A', 2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
});

test('groupMessages：20 封邮件、3 种 subject 的分组数与众数正确', () => {
  const messages = [];
  const plan = [7, 'Plan'];
  const sync = [8, 'Sync'];
  const lunch = [5, 'Team lunch'];
  for (const [count, subject] of [plan, sync, lunch]) {
    for (let i = 0; i < count; i += 1) messages.push(msg(subject, messages.length * 10));
  }
  const out = groupMessages(messages);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((g) => g.length).sort((a, b) => a - b),
    [5, 7, 8],
  );
  assert.equal(out.reduce((n, g) => n + g.length, 0), 20);
});
