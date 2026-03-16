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
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').trim() || null,
  reminderImageEmbed: /^(1|true|yes)$/i.test(
    (process.env.REMINDER_IMAGE_EMBED || '').trim()
  ),
  reminderImageFile: (process.env.REMINDER_IMAGE_FILE || 'qrcode.png').trim() || 'qrcode.png',
  reminderQRContent: (process.env.REMINDER_QR_CONTENT || '').trim() || null,
  /** Direct URL to PNG/image for debt reminders (e.g. Cloudinary, VietQR). Overrides QR/file when set. */
  reminderImageUrl: (process.env.REMINDER_IMAGE_URL || '').trim() || null,
  reminderPlainTextOnly: /^(1|true|yes)$/i.test(
    (process.env.REMINDER_PLAIN_TEXT_ONLY || '').trim()
  ),
  accountEmailDomain: process.env.ACCOUNT_EMAIL_DOMAIN || 'rikkeisoft.com',
  webhookToken: process.env.WEBHOOK_TOKEN || '',
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || '',
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || '',
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
  microsoftWebhookSecret: process.env.MICROSOFT_WEBHOOK_SECRET || ''
};
