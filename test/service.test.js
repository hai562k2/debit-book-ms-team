const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleEvent,
  createManualCampaign,
  markCampaignPaid,
  buildCompletionCard,
  buildCampaignCreatedCard,
  buildReminderTotalCard,
  buildReminderDailyCard,
  buildDebtByName,
  buildPairSettlements
} = require('../src/service');

function makeStore() {
  const campaigns = {};
  return {
    getCampaignByRootMessageId: (id) => campaigns[id] || null,
    upsertCampaign: (campaign) => {
      campaigns[campaign.rootMessageId] = campaign;
      return campaign;
    }
  };
}

test('handleEvent creates campaign from message.created', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: 'https://example.com/webhook'
  };

  const created = handleEvent(
    {
      eventType: 'message.created',
      messageId: 'm1',
      text: 'Trua nay moi nguoi 100k, tong 2 nguoi'
    },
    store,
    config
  );

  assert.equal(created.handled, true);
  assert.equal(created.type, 'campaign.created');

  const unsupported = handleEvent(
    { eventType: 'message.reaction', rootMessageId: 'm1' },
    store,
    config
  );
  assert.equal(unsupported.handled, false);
});

test('createManualCampaign creates campaign from UI form', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const created = createManualCampaign(
    {
      title: 'Com trua thu 5',
      perPersonAmount: 120000,
      expectedPeople: 6
    },
    store,
    config
  );

  assert.equal(created.title, 'Com trua thu 5');
  assert.equal(created.perPersonAmount, 120000);
  assert.equal(created.expectedPeople, 6);
  assert.equal(Boolean(created.rootMessageId), true);
});

test('createManualCampaign accepts manual dateKey for past lunch', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const created = createManualCampaign(
    {
      title: 'Bữa trưa quên đòi',
      dateKey: '2026-03-10',
      perPersonAmount: 50000,
      expectedPeople: 3
    },
    store,
    config
  );

  assert.equal(created.dateKey, '2026-03-10');
});

test('createManualCampaign uses participant names + payerCode as expected repayers', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const created = createManualCampaign(
    {
      title: 'Com trua thu 6',
      perPersonAmount: 50000,
      participantNames: ['anv1', 'bnv1', 'cnv1'],
      payerCode: 'anv1'
    },
    store,
    config
  );

  assert.equal(created.expectedPeople, 2);
  assert.deepEqual(created.participants, ['anv1', 'bnv1', 'cnv1']);
  assert.equal(created.payerCode, 'anv1');
});

test('buildDebtByName aggregates outstanding debt with creditor and date', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const campaignA = createManualCampaign(
    {
      messageId: 'm-a',
      title: 'Bua A',
      perPersonAmount: 30000,
      participantNames: ['anv1', 'bnv1'],
      payerCode: 'anv1'
    },
    store,
    config
  );
  const campaignB = createManualCampaign(
    {
      messageId: 'm-b',
      title: 'Bua B',
      perPersonAmount: 40000,
      participantNames: ['anv1', 'bnv1'],
      payerCode: 'bnv1'
    },
    store,
    config
  );

  const summary = buildDebtByName([campaignA, campaignB]);
  const an = summary.find((item) => item.name === 'anv1');
  const bn = summary.find((item) => item.name === 'bnv1');

  assert.equal(an.totalDebt, 40000);
  assert.deepEqual(an.owedTo, ['bnv1']);
  assert.equal(bn.totalDebt, 30000);
  assert.deepEqual(bn.owedTo, ['anv1']);
});

test('buildPairSettlements can offset debts between two users across days', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const campaignA = createManualCampaign(
    {
      messageId: 'm-offset-a',
      title: 'Bua offset A',
      perPersonAmount: 30000,
      participantNames: ['anv1', 'bnv1'],
      payerCode: 'anv1'
    },
    store,
    config
  );
  const campaignB = createManualCampaign(
    {
      messageId: 'm-offset-b',
      title: 'Bua offset B',
      perPersonAmount: 50000,
      participantNames: ['anv1', 'bnv1'],
      payerCode: 'bnv1'
    },
    store,
    config
  );

  const net = buildPairSettlements([campaignA, campaignB]);
  assert.equal(net.length, 1);
  assert.equal(net[0].debtorName, 'anv1');
  assert.equal(net[0].creditorName, 'bnv1');
  assert.equal(net[0].amount, 20000);
});

test('markCampaignPaid can match participant by user.id account code', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: ''
  };

  const campaign = createManualCampaign(
    {
      messageId: 'm-code',
      title: 'Bua code',
      perPersonAmount: 20000,
      participantNames: ['anv1', 'bnv1'],
      payerCode: 'anv1'
    },
    store,
    config
  );

  const paid = markCampaignPaid(
    campaign.rootMessageId,
    { id: 'bnv1', displayName: 'B Nguyen' },
    store
  );

  assert.equal(paid.payment.changed, true);
  assert.equal(paid.payment.participantName, 'bnv1');
});

test('markCampaignPaid can match participant by email with configured domain', () => {
  const store = makeStore();
  const config = {
    timezone: 'Asia/Ho_Chi_Minh',
    outgoingWebhookUrl: '',
    accountEmailDomain: 'rikkeisoft.com'
  };

  const campaign = createManualCampaign(
    {
      messageId: 'm-email',
      title: 'Bua email',
      perPersonAmount: 20000,
      participantNames: ['hainv1', 'bnv1'],
      payerCode: 'bnv1'
    },
    store,
    config
  );

  const paid = markCampaignPaid(
    campaign.rootMessageId,
    { email: 'hainv1@rikkeisoft.com' },
    store
  );

  assert.equal(paid.payment.changed, true);
  assert.equal(paid.payment.participantName, 'hainv1');
});

test('buildCampaignCreatedCard shows immediate debtor-creditor lines', () => {
  const campaign = {
    title: 'Com trua',
    dateKey: '2026-03-12',
    perPersonAmount: 40000,
    participants: ['anv1', 'bnv1'],
    payerCode: 'anv1',
    paidUsers: {},
    rootMessageId: 'm-created'
  };

  const card = buildCampaignCreatedCard(campaign, [campaign]);
  const text = card.map((el) => el.text || '').join(' ');
  assert.equal(text.includes('Ai nợ ai cho bữa này'), true);
  assert.equal(text.includes('bnv1 nợ anv1'), true);
});

test('buildCompletionCard includes settled status', () => {
  const card = buildCompletionCard({
    title: 'Com trua thu 5',
    perPersonAmount: 120000,
    expectedPeople: 2,
    participants: ['anv1', 'bnv1'],
    payerCode: 'anv1'
  });

  const hasTitle = card.some((el) => el.text && el.text.includes('Đã thu đủ'));
  const hasSettled = card.some((el) => el.facts && el.facts.some((f) => f.value && f.value.includes('Tạm dừng nhắc nợ')));
  assert.equal(hasTitle, true);
  assert.equal(hasSettled, true);
});

test('buildReminderTotalCard shows "Không ai nợ ai." when total debt is empty', () => {
  const card = buildReminderTotalCard([], '2026-03-12');
  const text = card.map((el) => el.text || '').join(' ');
  assert.equal(text.includes('Không ai nợ ai.'), true);
});

test('buildReminderDailyCard shows empty daily debt message when no open campaign', () => {
  const card = buildReminderDailyCard([], '2026-03-12');
  const text = card.map((el) => el.text || '').join(' ');
  assert.equal(text.includes('Không còn khoản nợ theo ngày.'), true);
});
