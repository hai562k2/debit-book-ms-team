const path = require('path');
require('dotenv').config();

module.exports = {
  backendPort: Number(process.env.BE_PORT || process.env.PORT || 3000),
  frontendPort: Number(process.env.FE_PORT || 5173),
  frontendOrigin: process.env.FRONTEND_ORIGIN || '',
  timezone: process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh',
  dailyReminderTimes: (process.env.DAILY_REMINDER_TIMES || '14:55,17:30')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  storageFile: process.env.STORAGE_FILE || path.join(process.cwd(), 'data', 'campaigns.json'),
  outgoingWebhookUrl: process.env.TEAMS_OUTGOING_WEBHOOK_URL || '',
  reminderImageEmbed: /^(1|true|yes)$/i.test(
    (process.env.REMINDER_IMAGE_EMBED || '').trim()
  ),
  reminderImageFile: (process.env.REMINDER_IMAGE_FILE || 'qrcode.png').trim() || 'qrcode.png',
  reminderImageUrl: (() => {
    if (/^(1|true|yes)$/i.test((process.env.REMINDER_IMAGE_EMBED || '').trim())) {
      return null;
    }
    const explicit = (process.env.REMINDER_IMAGE_URL || '').trim();
    if (explicit) return explicit;
    const baseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
    return baseUrl ? `${baseUrl}/qrcode.png` : null;
  })(),
  accountEmailDomain: process.env.ACCOUNT_EMAIL_DOMAIN || 'rikkeisoft.com',
  webhookToken: process.env.WEBHOOK_TOKEN || '',
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || '',
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || '',
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
  microsoftWebhookSecret: process.env.MICROSOFT_WEBHOOK_SECRET || ''
};
