const cron = require('node-cron');
const { nowDateAndTimeKeys } = require('./time');
const { buildReminderTotalCard, buildReminderDailyCard } = require('./service');
const { postToTeamsWebhookCard } = require('./notifier');

function startReminderScheduler(store, config, logger = console) {
  const slotSet = new Set(config.dailyReminderTimes);

  const task = cron.schedule('* * * * *', async () => {
    const { dateKey, timeKey } = nowDateAndTimeKeys(config.timezone);
    if (!slotSet.has(timeKey)) {
      return;
    }

    const openCampaigns = store
      .listOpenCampaigns()
      .filter((campaign) => campaign.reminderSlotsSent.indexOf(`${dateKey}_${timeKey}`) === -1);

    if (openCampaigns.length === 0) {
      return;
    }

    const groupedByWebhook = new Map();

    for (const campaign of openCampaigns) {
      const hook = campaign.reminderWebhookUrl || config.outgoingWebhookUrl;
      if (!hook) {
        logger.warn(`[scheduler] Missing webhook URL for campaign ${campaign.rootMessageId}`);
        campaign.reminderSlotsSent.push(`${dateKey}_${timeKey}`);
        store.upsertCampaign(campaign);
        continue;
      }

      if (!groupedByWebhook.has(hook)) {
        groupedByWebhook.set(hook, []);
      }
      groupedByWebhook.get(hook).push(campaign);
    }

    for (const [webhookUrl, campaigns] of groupedByWebhook.entries()) {
      const totalCardBody = buildReminderTotalCard(campaigns, dateKey);
      const dailyCardBody = buildReminderDailyCard(campaigns, dateKey);

      try {
        await postToTeamsWebhookCard(webhookUrl, totalCardBody);
        await postToTeamsWebhookCard(webhookUrl, dailyCardBody);

        for (const campaign of campaigns) {
          campaign.reminderSlotsSent.push(`${dateKey}_${timeKey}`);
          store.upsertCampaign(campaign);
        }

        logger.info(`[scheduler] Sent reminder for ${campaigns.length} campaigns at ${dateKey} ${timeKey}`);
      } catch (error) {
        logger.error(`[scheduler] Failed to send reminder: ${error.message}`);
      }
    }
  });

  return task;
}

module.exports = {
  startReminderScheduler
};
