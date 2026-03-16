const cron = require('node-cron');
const { nowDateAndTimeKeys } = require('./time');
const { buildReminderTotalText, buildReminderDailyText } = require('./service');
const { postToTeamsWebhook } = require('./notifier');

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
      const totalMessage = buildReminderTotalText(campaigns, dateKey);
      const dailyMessage = buildReminderDailyText(campaigns, dateKey);

      try {
        await postToTeamsWebhook(webhookUrl, totalMessage);
        await postToTeamsWebhook(webhookUrl, dailyMessage);

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
