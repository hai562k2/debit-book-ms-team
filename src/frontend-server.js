const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();

const apiBaseUrl =
  process.env.FE_API_BASE_URL || `http://localhost:${config.backendPort}`;

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(
    `window.APP_CONFIG = ${JSON.stringify({
      apiBaseUrl,
      accountEmailDomain: config.accountEmailDomain
    })};`
  );
});

app.use(express.static(path.join(process.cwd(), 'public')));

app.listen(config.frontendPort, () => {
  console.log(`Frontend listening on port ${config.frontendPort}`);
  console.log(`Frontend uses API base: ${apiBaseUrl}`);
});
