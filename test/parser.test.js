const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDebtMessage } = require('../src/parser');

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
