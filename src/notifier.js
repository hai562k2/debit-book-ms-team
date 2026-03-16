const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ADAPTIVE_CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const MAX_EMBED_BYTES = 18000;
let embeddedImageCache = null;

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

/**
 * Resolves image source for reminder: URL, embedded base64, or null.
 * @param {object} config - App config
 * @param {object|null} campaign - Campaign (may have reminderImageUrl)
 * @returns {Promise<string|null>}
 */
async function resolveReminderImage(config, campaign) {
  if (config.reminderImageEmbed) {
    return loadEmbeddedReminderImage(config);
  }
  return (campaign && campaign.reminderImageUrl) || config.reminderImageUrl || null;
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
      url: imageUrl.trim()
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
async function postToTeamsWebhook(webhookUrl, messageText, imageUrl = null) {
  if (!webhookUrl) {
    return { skipped: true, reason: 'No webhook URL configured.' };
  }

  const hasImage = imageUrl && typeof imageUrl === 'string' && imageUrl.trim();
  const payload = hasImage
    ? {
        type: 'message',
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
      }
    : { text: messageText };

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
  resolveReminderImage
};
