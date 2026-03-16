const express = require('express');
const path = require('path');
const config = require('./config');
const { CampaignStore } = require('./store');
const { postToTeamsWebhook, resolveReminderImage } = require('./notifier');
const {
  handleEvent,
  createManualCampaign,
  markCampaignPaid,
  buildCampaignCreatedText,
  buildCampaignProgressText,
  buildCompletionText,
  buildDebtByName,
  buildPairSettlements
} = require('./service');
const { startReminderScheduler } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '1mb' }));

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

  const message = buildCompletionText(campaign);
  const imageUrl = campaign.reminderImageUrl || config.reminderImageUrl || null;
  try {
    await postToTeamsWebhook(webhookUrl, message, imageUrl);
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
  const message = buildCampaignProgressText(campaign, payment, openCampaigns);
  const imageUrl = await resolveReminderImage(config, campaign);
  try {
    await postToTeamsWebhook(webhookUrl, message, imageUrl);
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
  const message = buildCampaignCreatedText(campaign, openCampaigns);
  const imageUrl = campaign.reminderImageUrl || config.reminderImageUrl || null;
  try {
    await postToTeamsWebhook(webhookUrl, message, imageUrl);
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

app.get('/qrcode.png', (req, res) => {
  const filePath = path.join(process.cwd(), 'qrcode.png');
  res.sendFile(filePath, { maxAge: 86400 });
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
    if (data.payment && data.payment.changed) {
      await maybeSendProgressNotice(data.campaign, data.payment);
    }
    await maybeSendCompletionNotice(data.campaign);
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/campaigns/:id/remind', async (req, res) => {
  try {
    const campaign = store.getCampaignByRootMessageId(req.params.id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy khoản thu' });
    }
    if (campaign.closedAt) {
      return res.status(400).json({ ok: false, error: 'Khoản thu đã đóng' });
    }

    const webhookUrl = resolveCampaignWebhook(campaign);
    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: 'Chưa cấu hình webhook Teams' });
    }

    const openCampaigns = store.listOpenCampaigns();
    const message = buildCampaignCreatedText(campaign, openCampaigns);
    const prefix = '🔔 Nhắc nợ thủ công:\n\n';
    const imageUrl = await resolveReminderImage(config, campaign);
    await postToTeamsWebhook(webhookUrl, prefix + message, imageUrl);

    return res.json({ ok: true, data: { sent: true } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(config.backendPort, () => {
  console.log(`Backend listening on port ${config.backendPort}`);
});
