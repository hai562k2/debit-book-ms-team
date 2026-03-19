const { parseDebtMessage, normalizeVietnamese } = require('./parser');
const { toDateKey } = require('./time');

function normalizeName(input) {
  if (!input || typeof input !== 'string') return '';
  return normalizeVietnamese(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeDomain(domain) {
  const raw = normalizeName(domain || '');
  if (!raw) return '';
  return raw.replace(/^@+/, '');
}

function toAccountKey(input, accountEmailDomain) {
  const value = normalizeName(input || '').replace(/\s+/g, '');
  if (!value) return '';

  if (!value.includes('@')) {
    return value;
  }

  const [localPart, domainPart] = value.split('@');
  if (!localPart) return '';

  const normalizedDomain = normalizeDomain(accountEmailDomain);
  if (!normalizedDomain || domainPart === normalizedDomain) {
    return localPart;
  }

  return `${localPart}@${domainPart}`;
}

function toAccountEmail(accountKey, accountEmailDomain) {
  const key = normalizeName(accountKey || '').replace(/\s+/g, '');
  if (!key) return '';
  if (key.includes('@')) return key;

  const normalizedDomain = normalizeDomain(accountEmailDomain);
  if (!normalizedDomain) return key;
  return `${key}@${normalizedDomain}`;
}

function parseParticipantNames(raw, accountEmailDomain) {
  let items = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    items = raw.split(/[\n,;]+/);
  }

  const unique = new Map();
  for (const item of items) {
    const value = typeof item === 'string' ? item.trim() : '';
    const key = toAccountKey(value, accountEmailDomain);
    if (!key) continue;
    if (!unique.has(key)) {
      unique.set(key, key);
    }
  }

  return Array.from(unique.values());
}

function getParticipantMap(campaign) {
  const map = new Map();
  const participants = Array.isArray(campaign.participants) ? campaign.participants : [];
  const accountEmailDomain = campaign.accountEmailDomain || '';

  for (const name of participants) {
    const key = toAccountKey(name, accountEmailDomain);
    if (!key || map.has(key)) continue;
    map.set(key, key);
  }

  return map;
}

function getPaidUsers(campaign) {
  if (!campaign.paidUsers || typeof campaign.paidUsers !== 'object') {
    campaign.paidUsers = {};
  }
  return campaign.paidUsers;
}

function getPaidParticipantKeys(campaign) {
  const keys = new Set();
  const accountEmailDomain = campaign.accountEmailDomain || '';
  for (const entry of Object.values(getPaidUsers(campaign))) {
    const key = toAccountKey(
      (entry && (entry.participantName || entry.displayName || entry.email || entry.userPrincipalName)) ||
        '',
      accountEmailDomain
    );
    if (key) keys.add(key);
  }
  return keys;
}

function getPayerKey(campaign) {
  return toAccountKey(campaign.payerCode || '', campaign.accountEmailDomain || '');
}

function getPayerDisplayName(campaign) {
  const payerKey = getPayerKey(campaign);
  const participantMap = getParticipantMap(campaign);
  if (payerKey && participantMap.has(payerKey)) {
    return participantMap.get(payerKey);
  }
  return toAccountKey(campaign.payerCode || '', campaign.accountEmailDomain || '');
}

function getExpectedRepayers(campaign) {
  const participantMap = getParticipantMap(campaign);
  if (participantMap.size === 0) {
    return Number(campaign.expectedPeople || 0);
  }

  const payerKey = getPayerKey(campaign);
  let count = 0;
  for (const key of participantMap.keys()) {
    if (payerKey && key === payerKey) {
      continue;
    }
    count += 1;
  }
  return count;
}

function getCampaignPaidCount(campaign) {
  const participantMap = getParticipantMap(campaign);
  if (participantMap.size > 0) {
    const paidKeys = getPaidParticipantKeys(campaign);
    const payerKey = getPayerKey(campaign);
    let count = 0;

    for (const key of participantMap.keys()) {
      if (payerKey && key === payerKey) continue;
      if (paidKeys.has(key)) count += 1;
    }

    return count;
  }

  return Object.keys(getPaidUsers(campaign)).length;
}

function getCampaignOutstandingCount(campaign) {
  return Math.max(getExpectedRepayers(campaign) - getCampaignPaidCount(campaign), 0);
}

function getOutstandingParticipantNames(campaign) {
  const participantMap = getParticipantMap(campaign);
  if (participantMap.size === 0) return [];

  const paidKeys = getPaidParticipantKeys(campaign);
  const payerKey = getPayerKey(campaign);
  const names = [];

  for (const [key, value] of participantMap.entries()) {
    if (payerKey && key === payerKey) continue;
    if (!paidKeys.has(key)) {
      names.push(value);
    }
  }

  return names;
}

function getAmountForParticipant(campaign, participantKey) {
  const amounts = campaign.perPersonAmounts;
  if (amounts && typeof amounts === 'object' && amounts[participantKey] != null) {
    const amount = Number(amounts[participantKey]);
    return amount > 0 ? amount : (campaign.perPersonAmount || 0);
  }
  return campaign.perPersonAmount || 0;
}

function getTotalExpectedAmount(campaign) {
  const participantMap = getParticipantMap(campaign);
  const payerKey = getPayerKey(campaign);
  let total = 0;
  for (const [key] of participantMap.entries()) {
    if (key === payerKey) continue;
    total += getAmountForParticipant(campaign, key);
  }
  return total;
}

function getTotalOutstandingAmount(campaign) {
  const debts = listCampaignOutstandingDebts(campaign);
  return debts.reduce((sum, d) => sum + d.amount, 0);
}

function listCampaignOutstandingDebts(campaign) {
  const participantMap = getParticipantMap(campaign);
  const payerKey = getPayerKey(campaign);
  if (participantMap.size === 0 || !payerKey) {
    return [];
  }

  const payerName = getPayerDisplayName(campaign) || campaign.payerCode;
  const accountEmailDomain = campaign.accountEmailDomain || '';
  const paidKeys = getPaidParticipantKeys(campaign);
  const debts = [];

  for (const [key, name] of participantMap.entries()) {
    if (key === payerKey) continue;
    if (paidKeys.has(key)) continue;

    const amount = getAmountForParticipant(campaign, key);
    if (amount <= 0) continue;

    debts.push({
      debtorKey: key,
      debtorName: name,
      debtorEmail: toAccountEmail(name, accountEmailDomain),
      creditorKey: payerKey,
      creditorName: payerName,
      creditorEmail: toAccountEmail(payerName, accountEmailDomain),
      amount,
      dateKey: campaign.dateKey,
      campaignTitle: campaign.title,
      rootMessageId: campaign.rootMessageId
    });
  }

  return debts;
}

function resolveReminderWebhookUrl(payload, store, config) {
  return payload.reminderWebhookUrl || config.outgoingWebhookUrl || '';
}

function buildCampaign(payload, parsedDebt, timezone, fallbackWebhookUrl, defaultAccountEmailDomain) {
  const rootMessageId = payload.messageId;
  const dateKey = toDateKey(new Date(payload.timestamp || Date.now()), timezone);
  const accountEmailDomain = normalizeDomain(
    payload.accountEmailDomain || defaultAccountEmailDomain || ''
  );
  const participantNames = parseParticipantNames(payload.participantNames, accountEmailDomain);
  const payerCode = toAccountKey(payload.payerCode || '', accountEmailDomain);

  const expectedPeople =
    participantNames.length > 0
      ? participantNames.length - (payerCode && participantNames.some((x) => x === payerCode) ? 1 : 0)
      : parsedDebt.expectedPeople;

  return {
    rootMessageId,
    title: parsedDebt.title,
    dateKey,
    createdAt: payload.timestamp || new Date().toISOString(),
    perPersonAmount: parsedDebt.perPersonAmount,
    expectedPeople: Math.max(expectedPeople, 0),
    participants: participantNames,
    payerCode,
    accountEmailDomain,
    sourceText: payload.text,
    paidUsers: {},
    reminderSlotsSent: [],
    closedAt: null,
    reminderWebhookUrl: payload.reminderWebhookUrl || fallbackWebhookUrl || '',
    context: {
      teamId: payload.teamId || null,
      channelId: payload.channelId || null,
      conversationId: payload.conversationId || null
    }
  };
}

function resolveParticipantKey(campaign, user) {
  const participantMap = getParticipantMap(campaign);
  if (participantMap.size === 0) {
    return null;
  }
  const accountEmailDomain = campaign.accountEmailDomain || '';

  const candidateKeys = [
    toAccountKey((user && user.id) || '', accountEmailDomain),
    toAccountKey((user && user.participantName) || '', accountEmailDomain),
    toAccountKey((user && user.displayName) || '', accountEmailDomain),
    toAccountKey((user && user.email) || '', accountEmailDomain),
    toAccountKey((user && user.mail) || '', accountEmailDomain),
    toAccountKey((user && user.userPrincipalName) || '', accountEmailDomain),
    toAccountKey((user && user.upn) || '', accountEmailDomain)
  ];

  for (const key of candidateKeys) {
    if (key && participantMap.has(key)) {
      return key;
    }
  }

  return null;
}

function applyPayment(campaign, user) {
  const payloadUser = user || {};
  const accountEmailDomain = campaign.accountEmailDomain || '';
  const paidUsers = getPaidUsers(campaign);
  const participantMap = getParticipantMap(campaign);
  const participantKey = resolveParticipantKey(campaign, payloadUser);
  const payerKey = getPayerKey(campaign);

  if (participantMap.size > 0 && !participantKey) {
    return { changed: false, reason: 'Không tìm thấy người trả trong danh sách người tham gia' };
  }

  if (participantKey && payerKey && participantKey === payerKey) {
    return { changed: false, reason: 'Người ứng tiền không cần trả lại' };
  }

  const identifier =
    (payloadUser.id && String(payloadUser.id).trim()) ||
    participantKey ||
    toAccountKey(payloadUser.email || payloadUser.mail || payloadUser.userPrincipalName || '', accountEmailDomain) ||
    normalizeName(payloadUser.displayName || '');

  if (!identifier) {
    return { changed: false, reason: 'Thiếu định danh người dùng' };
  }

  if (paidUsers[identifier]) {
    return { changed: false, reason: 'Người này đã được ghi nhận trước đó' };
  }

  if (participantKey) {
    const participantAlreadyPaid = Object.values(paidUsers).some((entry) => {
      return (
        toAccountKey(
          (entry && (entry.participantName || entry.displayName || entry.email || entry.userPrincipalName)) ||
            '',
          accountEmailDomain
        ) === participantKey
      );
    });

    if (participantAlreadyPaid) {
      return { changed: false, reason: 'Người này đã được ghi nhận trước đó' };
    }
  }

  const participantName =
    (participantKey && participantMap.get(participantKey)) ||
    toAccountKey(
      payloadUser.participantName ||
        payloadUser.email ||
        payloadUser.mail ||
        payloadUser.userPrincipalName ||
        payloadUser.displayName ||
        '',
      accountEmailDomain
    ) ||
    String(identifier);

  paidUsers[identifier] = {
    id: payloadUser.id || null,
    displayName: payloadUser.displayName || participantName,
    email: payloadUser.email || payloadUser.mail || payloadUser.userPrincipalName || toAccountEmail(participantName, accountEmailDomain),
    participantName,
    paidAt: new Date().toISOString()
  };

  campaign.expectedPeople = getExpectedRepayers(campaign);
  const paidCount = getCampaignPaidCount(campaign);
  const becameClosed = !campaign.closedAt && paidCount >= campaign.expectedPeople;
  if (becameClosed) {
    campaign.closedAt = new Date().toISOString();
  }

  return { changed: true, paidCount, becameClosed, participantName };
}

function buildPairSettlements(campaigns) {
  const pairMap = new Map();

  for (const campaign of campaigns) {
    if (campaign.closedAt) continue;

    for (const debt of listCampaignOutstandingDebts(campaign)) {
      const leftKey = debt.debtorKey < debt.creditorKey ? debt.debtorKey : debt.creditorKey;
      const rightKey = debt.debtorKey < debt.creditorKey ? debt.creditorKey : debt.debtorKey;
      const pairKey = `${leftKey}|${rightKey}`;

      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, {
          leftKey,
          rightKey,
          leftName: debt.debtorKey === leftKey ? debt.debtorName : debt.creditorName,
          rightName: debt.debtorKey === rightKey ? debt.debtorName : debt.creditorName,
          leftEmail: debt.debtorKey === leftKey ? debt.debtorEmail : debt.creditorEmail,
          rightEmail: debt.debtorKey === rightKey ? debt.debtorEmail : debt.creditorEmail,
          balance: 0,
          pendingDates: new Set()
        });
      }

      const row = pairMap.get(pairKey);
      const sign = debt.debtorKey === leftKey && debt.creditorKey === rightKey ? 1 : -1;
      row.balance += sign * debt.amount;
      row.pendingDates.add(debt.dateKey);
    }
  }

  const settlements = [];
  for (const row of pairMap.values()) {
    if (row.balance === 0) continue;

    if (row.balance > 0) {
      settlements.push({
        debtorName: row.leftName,
        debtorEmail: row.leftEmail,
        creditorName: row.rightName,
        creditorEmail: row.rightEmail,
        amount: row.balance,
        pendingDates: Array.from(row.pendingDates).sort()
      });
    } else {
      settlements.push({
        debtorName: row.rightName,
        debtorEmail: row.rightEmail,
        creditorName: row.leftName,
        creditorEmail: row.leftEmail,
        amount: Math.abs(row.balance),
        pendingDates: Array.from(row.pendingDates).sort()
      });
    }
  }

  return settlements.sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return `${a.debtorName}-${a.creditorName}`.localeCompare(`${b.debtorName}-${b.creditorName}`, 'vi');
  });
}

function buildDebtByName(campaigns) {
  const totals = new Map();

  for (const campaign of campaigns) {
    if (campaign.closedAt) continue;

    for (const debt of listCampaignOutstandingDebts(campaign)) {
      const current = totals.get(debt.debtorKey) || {
        name: debt.debtorName,
        email: debt.debtorEmail,
        totalDebt: 0,
        campaignCount: 0,
        pendingDates: [],
        owedTo: [],
        owedToEmails: []
      };

      current.totalDebt += debt.amount;
      current.campaignCount += 1;
      if (current.pendingDates.indexOf(debt.dateKey) === -1) {
        current.pendingDates.push(debt.dateKey);
      }
      if (current.owedTo.indexOf(debt.creditorName) === -1) {
        current.owedTo.push(debt.creditorName);
      }
      if (current.owedToEmails.indexOf(debt.creditorEmail) === -1) {
        current.owedToEmails.push(debt.creditorEmail);
      }
      totals.set(debt.debtorKey, current);
    }
  }

  const result = Array.from(totals.values()).map((item) => ({
    ...item,
    pendingDates: item.pendingDates.sort(),
    owedTo: item.owedTo.sort((a, b) => a.localeCompare(b, 'vi')),
    owedToEmails: item.owedToEmails.sort((a, b) => a.localeCompare(b, 'vi'))
  }));

  return result.sort((a, b) => {
    if (b.totalDebt !== a.totalDebt) {
      return b.totalDebt - a.totalDebt;
    }
    return a.name.localeCompare(b.name, 'vi');
  });
}

function buildCompletionCard(campaign) {
  const expected = getExpectedRepayers(campaign);
  const hasCustomAmounts = campaign.perPersonAmounts && typeof campaign.perPersonAmounts === 'object';
  const total = hasCustomAmounts
    ? getTotalExpectedAmount(campaign).toLocaleString('vi-VN')
    : ((campaign.perPersonAmount || 0) * expected).toLocaleString('vi-VN');
  const amountHint = hasCustomAmounts ? 'mỗi người khác nhau' : `${(campaign.perPersonAmount || 0).toLocaleString('vi-VN')} VND/người`;

  const body = [
    { type: 'TextBlock', text: `Đã thu đủ tiền bữa trưa: "${campaign.title}"`, wrap: true, weight: 'bolder', size: 'medium' },
    { type: 'FactSet', facts: [
      { title: 'Đã trả', value: `${expected}/${expected} người` },
      { title: 'Số tiền', value: `${amountHint}, tổng ${total} VND` },
      { title: 'Trạng thái', value: 'Tạm dừng nhắc nợ cho bữa này.' }
    ]}
  ];
  return body;
}

function buildProgressCard(campaign, payment, campaignsForNet = []) {
  const paidLabel = (payment && payment.participantName) || 'Một người';
  const expected = getExpectedRepayers(campaign);
  const paid = getCampaignPaidCount(campaign);
  const unpaidNames = getOutstandingParticipantNames(campaign);
  const settlements = buildPairSettlements(campaignsForNet);

  const body = [
    { type: 'TextBlock', text: `${paidLabel} đã trả cho bữa "${campaign.title}"`, wrap: true, weight: 'bolder', size: 'medium' },
    { type: 'FactSet', facts: [
      { title: 'Tiến độ bữa này', value: `${paid}/${expected}` },
      ...(unpaidNames.length > 0 ? [{ title: 'Còn nợ bữa này', value: unpaidNames.join(', ') }] : [])
    ]}
  ];
  if (settlements.length > 0) {
    body.push({ type: 'TextBlock', text: 'Cân đối hiện tại (đã bù trừ):', wrap: true, weight: 'bolder', spacing: 'medium' });
    for (const item of settlements) {
      body.push({ type: 'TextBlock', text: `${item.debtorName} nợ ${item.creditorName}: ${item.amount.toLocaleString('vi-VN')} VND`, wrap: true });
    }
  }
  return body;
}

function buildCampaignCreatedCard(campaign, campaignsForNet = []) {
  const payer = getPayerDisplayName(campaign);
  const debts = listCampaignOutstandingDebts(campaign);
  const settlements = buildPairSettlements(campaignsForNet);

  const body = [
    { type: 'TextBlock', text: `Khởi tạo thu nợ bữa trưa: "${campaign.title}" (${campaign.dateKey})`, wrap: true, weight: 'bolder', size: 'medium' },
    ...(payer ? [{ type: 'FactSet', facts: [{ title: 'Người ứng tiền', value: payer }] }] : [])
  ];
  if (debts.length === 0) {
    body.push({ type: 'TextBlock', text: 'Không xác định được danh sách ai nợ ai cho bữa này.', wrap: true });
  } else {
    body.push({ type: 'TextBlock', text: 'Ai nợ ai cho bữa này:', wrap: true, weight: 'bolder', spacing: 'medium' });
    for (const debt of debts) {
      body.push({ type: 'TextBlock', text: `${debt.debtorName} nợ ${debt.creditorName}: ${debt.amount.toLocaleString('vi-VN')} VND`, wrap: true });
    }
  }
  if (settlements.length > 0) {
    body.push({ type: 'TextBlock', text: 'Cân đối hiện tại (đã bù trừ):', wrap: true, weight: 'bolder', spacing: 'medium' });
    for (const item of settlements) {
      body.push({ type: 'TextBlock', text: `${item.debtorName} nợ ${item.creditorName}: ${item.amount.toLocaleString('vi-VN')} VND`, wrap: true });
    }
  }
  return body;
}

function buildReminderTotalCard(campaigns, dateKey) {
  const debtByName = buildDebtByName(campaigns);
  const settlements = buildPairSettlements(campaigns);

  const body = [
    { type: 'TextBlock', text: `Tổng nợ tiền trưa (${dateKey})`, wrap: true, weight: 'bolder', size: 'medium' }
  ];
  if (debtByName.length === 0) {
    body.push({ type: 'TextBlock', text: 'Không ai nợ ai.', wrap: true });
    return body;
  }
  body.push({ type: 'TextBlock', text: 'Tổng nợ theo người:', wrap: true, weight: 'bolder', spacing: 'medium' });
  for (const item of debtByName) {
    body.push({ type: 'TextBlock', text: `${item.name}: nợ ${item.totalDebt.toLocaleString('vi-VN')} VND cho ${item.owedTo.join(', ')}; ngày nợ: ${item.pendingDates.join(', ')}`, wrap: true });
  }
  if (settlements.length > 0) {
    body.push({ type: 'TextBlock', text: 'Cân đối ai nợ ai (đã bù trừ giữa các ngày):', wrap: true, weight: 'bolder', spacing: 'medium' });
    for (const item of settlements) {
      body.push({ type: 'TextBlock', text: `${item.debtorName} nợ ${item.creditorName}: ${item.amount.toLocaleString('vi-VN')} VND (ngày: ${item.pendingDates.join(', ')})`, wrap: true });
    }
  }
  return body;
}

function buildReminderDailyCard(campaigns, dateKey) {
  const body = [{ type: 'TextBlock', text: `Nợ theo ngày (${dateKey})`, wrap: true, weight: 'bolder', size: 'medium' }];

  let hasContent = false;
  for (const campaign of campaigns) {
    const paidCount = getCampaignPaidCount(campaign);
    const expected = getExpectedRepayers(campaign);
    const outstanding = getCampaignOutstandingCount(campaign);
    if (outstanding === 0) continue;

    hasContent = true;
    const backlogDay = campaign.dateKey === dateKey ? 'Hôm nay' : `Nợ từ ${campaign.dateKey}`;
    const hasCustomAmounts = campaign.perPersonAmounts && typeof campaign.perPersonAmounts === 'object';
    const amountHint = hasCustomAmounts ? 'mỗi người khác nhau' : `${(campaign.perPersonAmount || 0).toLocaleString('vi-VN')} VND/người`;
    const totalOutstanding = hasCustomAmounts
      ? getTotalOutstandingAmount(campaign).toLocaleString('vi-VN')
      : ((campaign.perPersonAmount || 0) * outstanding).toLocaleString('vi-VN');
    const unpaidNames = getOutstandingParticipantNames(campaign);
    const payer = getPayerDisplayName(campaign) || 'Không rõ';
    const namesHint = unpaidNames.length > 0 ? ` Chưa trả: ${unpaidNames.join(', ')}.` : '';

    body.push({
      type: 'TextBlock',
      text: `${backlogDay}: còn ${outstanding}/${expected} người chưa trả (${amountHint}, tổng nợ ${totalOutstanding} VND). Đã trả ${paidCount}/${expected}. Người ứng: ${payer}. Tin gốc: "${campaign.title}".${namesHint}`,
      wrap: true,
      spacing: 'medium'
    });
  }
  if (!hasContent) {
    body.push({ type: 'TextBlock', text: 'Không còn khoản nợ theo ngày.', wrap: true });
  }
  return body;
}

function handleEvent(payload, store, config) {
  const eventType = payload.eventType;

  if (eventType === 'message.created') {
    const parsedDebt = parseDebtMessage(payload.text || '');
    if (!parsedDebt) {
      return { handled: false, reason: 'Tin nhắn không đúng mẫu tạo công nợ' };
    }

    const campaign = buildCampaign(
      payload,
      parsedDebt,
      config.timezone,
      resolveReminderWebhookUrl(payload, store, config),
      config.accountEmailDomain
    );
    campaign.expectedPeople = getExpectedRepayers(campaign);
    store.upsertCampaign(campaign);

    return {
      handled: true,
      type: 'campaign.created',
      campaign
    };
  }

  return { handled: false, reason: `Không hỗ trợ eventType: ${eventType}` };
}

function createManualCampaign(payload, store, config) {
  const accountEmailDomain = normalizeDomain(
    payload.accountEmailDomain || config.accountEmailDomain || ''
  );
  const participantNames = parseParticipantNames(payload.participantNames, accountEmailDomain);
  const expectedPeopleFromInput = Number(payload.expectedPeople);
  const perPersonAmount = Number(payload.perPersonAmount);
  const perPersonAmounts = payload.perPersonAmounts;
  const payerCode = toAccountKey(payload.payerCode || '', accountEmailDomain);
  const dateKeyInput =
    typeof payload.dateKey === 'string' ? payload.dateKey.trim() : '';

  if (!payload.title || typeof payload.title !== 'string') {
    throw new Error('Thiếu title');
  }
  if (perPersonAmounts && typeof perPersonAmounts === 'object') {
    if (participantNames.length === 0) {
      throw new Error('perPersonAmounts cần participantNames');
    }
    for (const name of participantNames) {
      const key = toAccountKey(name, accountEmailDomain);
      if (key === payerCode) continue;
      const amount = Number(perPersonAmounts[key]);
      if (!amount || amount <= 0) {
        throw new Error(`Số tiền cho ${name} phải > 0`);
      }
    }
  } else if (!perPersonAmount || perPersonAmount <= 0) {
    throw new Error('perPersonAmount phải > 0');
  }
  if (participantNames.length > 0 && !payerCode) {
    throw new Error('Cần payerCode khi có participantNames');
  }
  if (dateKeyInput && !/^\d{4}-\d{2}-\d{2}$/.test(dateKeyInput)) {
    throw new Error('dateKey phải có định dạng YYYY-MM-DD');
  }

  const messageId = payload.messageId || `manual-${Date.now()}`;
  const timestamp = payload.timestamp || new Date().toISOString();
  const dateKey = dateKeyInput || toDateKey(new Date(timestamp), config.timezone);
  const campaign = {
    rootMessageId: messageId,
    title: payload.title.trim(),
    dateKey,
    createdAt: timestamp,
    perPersonAmount: perPersonAmounts ? 0 : perPersonAmount,
    perPersonAmounts: perPersonAmounts || undefined,
    expectedPeople: expectedPeopleFromInput,
    participants: participantNames,
    payerCode,
    accountEmailDomain,
    sourceText: payload.sourceText || payload.title.trim(),
    paidUsers: {},
    reminderSlotsSent: [],
    closedAt: null,
    reminderWebhookUrl: resolveReminderWebhookUrl(payload, store, config),
    context: {
      teamId: payload.teamId || null,
      channelId: payload.channelId || null,
      conversationId: payload.conversationId || null
    }
  };

  campaign.expectedPeople = participantNames.length > 0 ? getExpectedRepayers(campaign) : expectedPeopleFromInput;
  if (!campaign.expectedPeople || campaign.expectedPeople <= 0) {
    throw new Error('expectedPeople phải > 0');
  }

  store.upsertCampaign(campaign);
  return campaign;
}

function markCampaignPaid(rootMessageId, user, store) {
  const campaign = store.getCampaignByRootMessageId(rootMessageId);
  if (!campaign) {
    throw new Error(`Không tìm thấy campaign cho ${rootMessageId}`);
  }

  campaign.expectedPeople = getExpectedRepayers(campaign);
  const result = applyPayment(campaign, user || {});
  if (result.changed) {
    store.upsertCampaign(campaign);
  }

  return { campaign, payment: result };
}

module.exports = {
  handleEvent,
  buildCompletionCard,
  buildProgressCard,
  buildCampaignCreatedCard,
  buildReminderTotalCard,
  buildReminderDailyCard,
  buildDebtByName,
  buildPairSettlements,
  getCampaignPaidCount,
  getCampaignOutstandingCount,
  parseParticipantNames,
  createManualCampaign,
  markCampaignPaid
};
