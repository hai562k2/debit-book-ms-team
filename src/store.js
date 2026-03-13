const fs = require('fs');
const path = require('path');

class CampaignStore {
  constructor(storageFile) {
    this.storageFile = storageFile;
    this.state = {
      campaigns: {}
    };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        campaigns: parsed.campaigns || {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      this.ensureDir();
      this.persist();
    }
  }

  ensureDir() {
    const dir = path.dirname(this.storageFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  persist() {
    this.ensureDir();
    fs.writeFileSync(this.storageFile, JSON.stringify(this.state, null, 2));
  }

  getCampaignByRootMessageId(rootMessageId) {
    return this.state.campaigns[rootMessageId] || null;
  }

  upsertCampaign(campaign) {
    this.state.campaigns[campaign.rootMessageId] = campaign;
    this.persist();
    return campaign;
  }

  removeCampaign(rootMessageId) {
    if (!this.state.campaigns[rootMessageId]) {
      return false;
    }
    delete this.state.campaigns[rootMessageId];
    this.persist();
    return true;
  }

  listOpenCampaigns() {
    return Object.values(this.state.campaigns).filter((campaign) => !campaign.closedAt);
  }
}

module.exports = {
  CampaignStore
};
