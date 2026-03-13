const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDebtMessage, parseDebtCommand } = require('../src/parser');

test('parseDebtCommand should parse /no with participants', () => {
  const parsed = parseDebtCommand('/no 50k anv1,bnv1,cnv1 anv1');
  assert.ok(parsed && !parsed.help);
  assert.equal(parsed.perPersonAmount, 50000);
  assert.deepEqual(parsed.participants.sort(), ['anv1', 'bnv1', 'cnv1']);
  assert.equal(parsed.payerCode, 'anv1');
});

test('parseDebtCommand should parse /no with count', () => {
  const parsed = parseDebtCommand('/no 100k 3 người luanvt');
  assert.ok(parsed && !parsed.help);
  assert.equal(parsed.perPersonAmount, 100000);
  assert.equal(parsed.expectedPeople, 3);
  assert.equal(parsed.payerCode, 'luanvt');
  assert.equal(parsed.participants.length, 0);
});

test('parseDebtCommand should return help for /no help', () => {
  const parsed = parseDebtCommand('/no help');
  assert.ok(parsed && parsed.help);
  assert.ok(parsed.message && parsed.message.includes('/no'));
});

test('parseDebtCommand should reject non-command text', () => {
  assert.equal(parseDebtCommand('hello world'), null);
});

test('parseDebtMessage should parse Vietnamese debt reminder', () => {
  const parsed = parseDebtMessage('Trua nay moi nguoi 100k, tong 10 nguoi');
  assert.deepEqual(parsed, {
    perPersonAmount: 100000,
    expectedPeople: 10,
    title: 'Trua nay moi nguoi 100k, tong 10 nguoi'
  });
});

test('parseDebtMessage should reject unrelated text', () => {
  const parsed = parseDebtMessage('Hello everyone, meeting at 2pm');
  assert.equal(parsed, null);
});
