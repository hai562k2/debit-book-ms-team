function normalizeVietnamese(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function parseAmount(rawAmount, unit) {
  const amount = Number(rawAmount.replace(/[,\.]/g, ''));
  if (Number.isNaN(amount)) return null;

  const normalizedUnit = (unit || '').toLowerCase();
  if (normalizedUnit === 'k' || normalizedUnit.includes('nghin') || normalizedUnit.includes('ngan')) {
    return amount * 1000;
  }
  return amount;
}

function parseDebtMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const plain = normalizeVietnamese(text.toLowerCase());
  if (!plain.includes('trua')) return null;

  const amountMatch = plain.match(/moi\s*nguoi\s*(\d+[\d.,]*)\s*(k|nghin|ngan|vnd|d)?/i);
  const totalPeopleMatch = plain.match(/tong\s*(\d+)\s*(nguoi)?/i);

  if (!amountMatch || !totalPeopleMatch) return null;

  const perPersonAmount = parseAmount(amountMatch[1], amountMatch[2]);
  const expectedPeople = Number(totalPeopleMatch[1]);

  if (!perPersonAmount || !expectedPeople || expectedPeople <= 0) return null;

  return {
    perPersonAmount,
    expectedPeople,
    title: text.trim()
  };
}

module.exports = {
  parseDebtMessage,
  normalizeVietnamese
};
