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

const DEBT_COMMAND_PREFIX = /^\s*(\/no|\/debt)\s+/i;

const DEBT_COMMAND_HELP = `**Lệnh tạo khoản nợ trong Teams**

\`/no\` hoặc \`/debt\` - Tạo khoản nợ qua lệnh:

1. **Có danh sách người:** \`/no <số tiền> <người1,người2,...> <người ứng>\`
   - VD: \`/no 50k anv1,bnv1,cnv1 anv1\`
   - VD: \`/no 100k anv1 bnv1 cnv1 luanvt\`

2. **Chỉ số người:** \`/no <số tiền> <số> người <người ứng>\`
   - VD: \`/no 100k 3 người luanvt\`

Số tiền: \`50k\`, \`100000\`, \`100k\` (k = nghìn)`;

/**
 * Parse debt command from Teams chat.
 * Format: /no <amount> <participants> <payer>
 *   - /no 50k anv1,bnv1,cnv1 anv1
 *   - /no 100k 3 người luanvt
 * @param {string} text - Raw message text
 * @returns {{ perPersonAmount: number, expectedPeople: number, participants: string[], payerCode: string, title: string } | { help: true, message: string } | null}
 */
function parseDebtCommand(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (!DEBT_COMMAND_PREFIX.test(trimmed)) return null;

  const withoutPrefix = trimmed.replace(DEBT_COMMAND_PREFIX, '').trim();
  if (/^help\s*$/i.test(withoutPrefix) || withoutPrefix === '') {
    return { help: true, message: DEBT_COMMAND_HELP };
  }
  const amountMatch = withoutPrefix.match(/^(\d+[\d.,]*)\s*(k|nghin|ngan|vnd|d)?\s+/i);
  if (!amountMatch) return null;

  const perPersonAmount = parseAmount(amountMatch[1], amountMatch[2]);
  if (!perPersonAmount || perPersonAmount <= 0) return null;

  const rest = withoutPrefix.slice(amountMatch[0].length).trim();
  const countMatch = rest.match(/^(\d+)\s*(nguoi|người)\s+(.+)$/i);

  let participants = [];
  let payerCode = '';
  let expectedPeople = 0;

  if (countMatch) {
    expectedPeople = Number(countMatch[1]);
    payerCode = countMatch[3].trim().replace(/^@+/, '');
    if (!expectedPeople || expectedPeople <= 0 || !payerCode) return null;
  } else {
    const tokens = rest.split(/[\s,;]+/).map((t) => t.replace(/^@+/, '').trim()).filter(Boolean);
    if (tokens.length < 2) return null;

    payerCode = tokens[tokens.length - 1];
    participants = [...new Set(tokens)];
  }

  const title = `[CMD] ${trimmed}`;
  return {
    perPersonAmount,
    expectedPeople,
    participants: participants.length > 0 ? participants : [],
    payerCode,
    title
  };
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
  parseDebtCommand,
  normalizeVietnamese,
  DEBT_COMMAND_HELP
};
