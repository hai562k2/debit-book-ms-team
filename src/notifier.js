async function postToTeamsWebhook(webhookUrl, messageText) {
  if (!webhookUrl) {
    return { skipped: true, reason: 'No webhook URL configured.' };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: messageText
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Teams webhook error ${response.status}: ${body}`);
  }

  return { sent: true };
}

module.exports = {
  postToTeamsWebhook
};
