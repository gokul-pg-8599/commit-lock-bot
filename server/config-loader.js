'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

let config = null;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`ERROR: config.json not found at ${CONFIG_PATH}`);
    console.error('Copy server/config.json and fill in your team settings.');
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    console.error('ERROR: Failed to parse config.json:', err.message);
    process.exit(1);
  }

  // Resolve file paths relative to server/ directory
  config.stateFilePath = path.resolve(__dirname, config.stateFilePath || './lock-state.json');
  config.historyFilePath = path.resolve(__dirname, config.historyFilePath || './lock-history.json');

  // Validate required fields
  if (!config.adminKey || config.adminKey === 'change-this-admin-key') {
    console.warn('WARNING: adminKey is set to default. Please change it in config.json.');
  }

  if (config.cliqEnabled && (!config.cliqNotifyUrl || config.cliqNotifyUrl.includes('YOUR_ZAPIKEY'))) {
    console.warn('WARNING: cliqEnabled is true but cliqNotifyUrl is not configured. Disabling Cliq notifications.');
    config.cliqEnabled = false;
  }

  return config;
}

function getConfig() {
  if (!config) {
    return loadConfig();
  }
  return config;
}

module.exports = { loadConfig, getConfig };
