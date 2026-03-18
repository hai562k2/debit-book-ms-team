const express = require('express');
const config = require('./config');
const { CampaignStore } = require('./store');
const {
  postToTeamsWebhookCard,
  resolveReminderImage,
  generateReminderQRBuffer,
  buildTemplate
} = require('./notifier');
const {
  handleEvent,
  createManualCampaign,
  markCampaignPaid,
  buildCompletionCard,
  buildProgressCard,
  buildCampaignCreatedCard,
  buildDebtByName,
  buildPairSettlements
} = require('./service');
const { startReminderScheduler } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '1mb' }));
const ERROR_CAMPAIGN_NOT_FOUND = 'Không tìm thấy khoản thu';
const ERROR_CAMPAIGN_CLOSED = 'Khoản thu đã đóng';
const ERROR_MISSING_WEBHOOK = 'Chưa cấu hình webhook Teams';
const ERROR_MISSING_QR_IMAGE = 'Chưa cấu hình ảnh QR (REMINDER_QR_CONTENT, REMINDER_IMAGE_URL hoặc qrcode.png)';

const allowedOrigin =
  config.frontendOrigin || `http://localhost:${config.frontendPort}`;
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type,x-webhook-token'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const store = new CampaignStore(config.storageFile);
startReminderScheduler(store, config);

function resolveCampaignWebhook(campaign) {
  return campaign.reminderWebhookUrl || config.outgoingWebhookUrl || '';
}

/**
 * Finds campaign and webhook for notification routes.
 * @param {string} campaignId - Root message id of campaign
 * @returns {{campaign: object|null, webhookUrl: string}}
 */
function getCampaignAndWebhook(campaignId) {
  const campaign = store.getCampaignByRootMessageId(campaignId);
  if (!campaign) return { campaign: null, webhookUrl: '' };
  return { campaign, webhookUrl: resolveCampaignWebhook(campaign) };
}

async function maybeSendCompletionNotice(campaign) {
  if (!campaign || !campaign.closedAt) {
    return;
  }

  const webhookUrl = resolveCampaignWebhook(campaign);
  if (!webhookUrl) {
    console.warn(
      `[completion] Campaign ${campaign.rootMessageId} is closed but no webhook URL is configured.`
    );
    return;
  }

  const cardBody = buildCompletionCard(campaign);
  try {
    await postToTeamsWebhookCard(webhookUrl, cardBody);
  } catch (error) {
    console.error(
      `[completion] Failed to send completion notice for ${campaign.rootMessageId}: ${error.message}`
    );
  }

  store.removeCampaign(campaign.rootMessageId);
}

async function maybeSendProgressNotice(campaign, payment) {
  if (!campaign || campaign.closedAt) {
    return;
  }

  const webhookUrl = resolveCampaignWebhook(campaign);
  if (!webhookUrl) {
    return;
  }

  const openCampaigns = store.listOpenCampaigns();
  const cardBody = buildProgressCard(campaign, payment, openCampaigns);
  try {
    await postToTeamsWebhookCard(webhookUrl, cardBody);
  } catch (error) {
    console.error(
      `[progress] Failed to send progress notice for ${campaign.rootMessageId}: ${error.message}`
    );
  }
}

async function maybeSendCampaignCreatedNotice(campaign) {
  if (!campaign) return;

  const webhookUrl = resolveCampaignWebhook(campaign);
  if (!webhookUrl) {
    return;
  }

  const openCampaigns = store.listOpenCampaigns();
  const cardBody = buildCampaignCreatedCard(campaign, openCampaigns);
  try {
    await postToTeamsWebhookCard(webhookUrl, cardBody);
  } catch (error) {
    console.error(
      `[created] Failed to send created notice for ${campaign.rootMessageId}: ${error.message}`
    );
  }
}

function isAuthorized(req) {
  if (!config.webhookToken) {
    return true;
  }
  const token = req.header('x-webhook-token');
  return token === config.webhookToken;
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/reminder-qr', async (req, res) => {
  const content = buildTemplate(config.reminderQRContent || '', null);
  if (!content) {
    return res.status(404).send('QR content not configured');
  }
  const buffer = await generateReminderQRBuffer(content);
  if (!buffer) {
    return res.status(500).send('Failed to generate QR');
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.type('image/jpeg');
  res.send(buffer);
});

app.post('/webhook/teams', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Không có quyền truy cập' });
  }

  try {
    const result = handleEvent(req.body, store, config);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/campaigns/open', (req, res) => {
  res.json({ ok: true, data: store.listOpenCampaigns() });
});

app.get('/debts/by-name', (req, res) => {
  const openCampaigns = store.listOpenCampaigns();
  const data = buildDebtByName(openCampaigns);
  res.json({ ok: true, data });
});

app.get('/debts/settlements', (req, res) => {
  const openCampaigns = store.listOpenCampaigns();
  const data = buildPairSettlements(openCampaigns);
  res.json({ ok: true, data });
});

app.post('/campaigns/manual', async (req, res) => {
  try {
    const campaign = createManualCampaign(req.body, store, config);
    await maybeSendCampaignCreatedNotice(campaign);
    return res.json({ ok: true, data: campaign });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/campaigns/:id/paid', async (req, res) => {
  try {
    const user = {
      id: req.body.userId,
      displayName: req.body.displayName,
      participantName: req.body.participantName,
      email: req.body.email || req.body.mail || req.body.userPrincipalName
    };
    const data = markCampaignPaid(req.params.id, user, store);
    await maybeSendCompletionNotice(data.campaign);
    if (data.payment && data.payment.changed && !data.payment.becameClosed) {
      await maybeSendProgressNotice(data.campaign, data.payment);
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/campaigns/:id/remind', async (req, res) => {
  try {
    const { campaign, webhookUrl } = getCampaignAndWebhook(req.params.id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: ERROR_CAMPAIGN_NOT_FOUND });
    }
    if (campaign.closedAt) {
      return res.status(400).json({ ok: false, error: ERROR_CAMPAIGN_CLOSED });
    }
    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: ERROR_MISSING_WEBHOOK });
    }

    const openCampaigns = store.listOpenCampaigns();
    const cardBody = [
      { type: 'TextBlock', text: '🔔 Nhắc nợ thủ công:', wrap: true, weight: 'bolder', size: 'medium' },
      ...buildCampaignCreatedCard(campaign, openCampaigns)
    ];
    await postToTeamsWebhookCard(webhookUrl, cardBody);

    console.log(`[remind] Sent manual reminder for campaign ${campaign.rootMessageId}`);
    return res.json({ ok: true, data: { sent: true } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/campaigns/:id/send-qr-image', async (req, res) => {
  try {
    const { campaign, webhookUrl } = getCampaignAndWebhook(req.params.id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: ERROR_CAMPAIGN_NOT_FOUND });
    }
    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: ERROR_MISSING_WEBHOOK });
    }

    const imageUrl = await resolveReminderImage(config, campaign);
    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({ ok: false, error: ERROR_MISSING_QR_IMAGE });
    }

    const cardBody = [{ type: 'Image', url: imageUrl.trim(), size: 'large' }];
    await postToTeamsWebhookCard(webhookUrl, cardBody);

    console.log(`[send-qr] Sent QR image for campaign ${campaign.rootMessageId}`);
    return res.json({ ok: true, data: { sent: true } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(config.backendPort, () => {
  console.log(`Backend listening on port ${config.backendPort}`);
});
