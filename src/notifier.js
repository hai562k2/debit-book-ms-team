const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const QRCode = require('qrcode');

const ADAPTIVE_CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const MAX_EMBED_BYTES = 18000;
let embeddedImageCache = null;
let generatedQRCache = null;
let generatedQRCacheKey = null;

/**
 * Builds text from template. Supports {{rootMessageId}}, {{title}}, {{dateKey}}, {{perPersonAmount}}.
 * @param {string} template - Template string
 * @param {object|null} campaign - Campaign for placeholder replacement
 * @returns {string}
 */
function buildTemplate(template, campaign) {
  if (!template || typeof template !== 'string') return '';
  let out = template.trim();
  if (!campaign) return out;
  out = out.replace(/\{\{rootMessageId\}\}/g, campaign.rootMessageId || '');
  out = out.replace(/\{\{title\}\}/g, (campaign.title || '').replace(/"/g, ''));
  out = out.replace(/\{\{dateKey\}\}/g, campaign.dateKey || '');
  out = out.replace(/\{\{perPersonAmount\}\}/g, String(campaign.perPersonAmount || ''));
  return out;
}

/**
 * Generates QR code from text, returns JPEG buffer for serving.
 * @param {string} content - Text/URL to encode
 * @returns {Promise<Buffer|null>}
 */
async function generateReminderQRBuffer(content) {
  if (!content || typeof content !== 'string' || !content.trim()) return null;
  try {
    const pngBuffer = await QRCode.toBuffer(content, {
      margin: 2,
      width: 256,
      errorCorrectionLevel: 'M'
    });
    return sharp(pngBuffer)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
  } catch (err) {
    return null;
  }
}

/**
 * Generates QR code from text, compresses to fit Teams payload limit, returns data URI.
 * @param {string} content - Text/URL to encode
 * @param {object} config - App config
 * @returns {Promise<string|null>} data URI or null
 */
async function generateReminderQRCode(content, config) {
  if (!content || typeof content !== 'string' || !content.trim()) return null;

  const cacheKey = content;
  if (generatedQRCache && generatedQRCacheKey === cacheKey) {
    return generatedQRCache;
  }

  try {
    const pngBuffer = await QRCode.toBuffer(content, {
      margin: 2,
      width: 256,
      errorCorrectionLevel: 'M'
    });

    let buffer = await sharp(pngBuffer)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    if (buffer.length > MAX_EMBED_BYTES) {
      buffer = await sharp(buffer)
        .resize(150, 150, { fit: 'inside' })
        .jpeg({ quality: 65 })
        .toBuffer();
    }

    generatedQRCache = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    generatedQRCacheKey = cacheKey;
    return generatedQRCache;
  } catch (err) {
    return null;
  }
}

/**
 * Loads image from project, compresses to fit Teams payload limit, returns data URI.
 * @param {object} config - App config with reminderImageFile
 * @returns {Promise<string|null>} data URI or null
 */
async function loadEmbeddedReminderImage(config) {
  if (embeddedImageCache) return embeddedImageCache;

  const filePath = path.join(process.cwd(), config.reminderImageFile || 'qrcode.png');
  if (!fs.existsSync(filePath)) return null;

  try {
    const buffer = await sharp(filePath)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    if (buffer.length > MAX_EMBED_BYTES) {
      const smaller = await sharp(buffer)
        .resize(200, 200, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toBuffer();
      embeddedImageCache = `data:image/jpeg;base64,${smaller.toString('base64')}`;
    } else {
      embeddedImageCache = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }
    return embeddedImageCache;
  } catch (err) {
    return null;
  }
}

const HTTPS_URL_REGEX = /^https:\/\/.+/i;

/**
 * Resolves image source for reminder: direct URL, generated QR, or file.
 * Priority: REMINDER_IMAGE_URL > REMINDER_QR_CONTENT > REMINDER_IMAGE_EMBED.
 * @param {object} config - App config
 * @param {object|null} campaign - Campaign for template placeholders
 * @returns {Promise<string|null>}
 */
async function resolveReminderImage(config, campaign) {
  if (config.reminderPlainTextOnly) return null;

  if (config.reminderImageUrl && HTTPS_URL_REGEX.test(config.reminderImageUrl.trim())) {
    return buildTemplate(config.reminderImageUrl.trim(), campaign) || config.reminderImageUrl.trim();
  }

  if (config.reminderQRContent) {
    const content = buildTemplate(config.reminderQRContent, campaign);
    if (content) {
      if (config.publicBaseUrl) {
        const base = config.publicBaseUrl.replace(/\/$/, '');
        return `${base}/api/reminder-qr`;
      }
      const dataUri = await generateReminderQRCode(content, config);
      if (dataUri) return dataUri;
    }
  }

  if (config.reminderImageEmbed) {
    return loadEmbeddedReminderImage(config);
  }
  return null;
}

/**
 * Builds Adaptive Card body with optional image.
 * @param {string} messageText - Text content
 * @param {string|null} imageUrl - Optional image URL to embed
 * @returns {object[]} Adaptive Card body elements
 */
function buildAdaptiveCardBody(messageText, imageUrl) {
  const body = [
    {
      type: 'TextBlock',
      text: messageText,
      wrap: true
    }
  ];
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim()) {
    body.push({
      type: 'Image',
      url: imageUrl.trim(),
      size: 'medium'
    });
  }
  return body;
}

/**
 * Posts message to Teams webhook. When imageUrl is provided, sends Adaptive Card with embedded image.
 * @param {string} webhookUrl - Teams webhook URL
 * @param {string} messageText - Message text
 * @param {string|null} [imageUrl] - Optional image URL to embed in the message
 * @returns {Promise<{sent: boolean}|{skipped: boolean, reason: string}>}
 */
const MAX_PAYLOAD_BYTES = 25000;

async function postToTeamsWebhook(webhookUrl, messageText, imageUrl = null) {
  if (!webhookUrl) {
    return { skipped: true, reason: 'No webhook URL configured.' };
  }

  const hasImage = imageUrl && typeof imageUrl === 'string' && imageUrl.trim();
  const isDataUri = hasImage && imageUrl.trim().toLowerCase().startsWith('data:');
  const useAdaptiveCard = hasImage && !isDataUri;

  /** Power Automate thường chỉ chuyển text, không gửi Adaptive Card. Thêm link ảnh vào text để user click xem. */
  const textToSend = useAdaptiveCard
    ? `${messageText}\n\n📷 QR chuyển khoản: ${imageUrl.trim()}`
    : messageText;

  let payload;
  if (useAdaptiveCard) {
    payload = {
      type: 'message',
      text: textToSend,
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: ADAPTIVE_CARD_SCHEMA,
            type: 'AdaptiveCard',
            version: '1.2',
            body: buildAdaptiveCardBody(messageText, imageUrl)
          }
        }
      ]
    };
  } else {
    payload = { text: textToSend };
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PAYLOAD_BYTES && useAdaptiveCard) {
    payload = { text: textToSend };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Teams webhook error ${response.status}: ${body}`);
  }

  return { sent: true };
}

module.exports = {
  postToTeamsWebhook,
  resolveReminderImage,
  generateReminderQRBuffer,
  buildTemplate
};
