'use strict';

const fs = require('fs');
const { getConfig } = require('./config-loader');

const DEFAULT_STATE = {
  locked: false,
  holder: null,
  since: null,
  commitMessage: null,
  queue: [],
  lastActivity: null
};

let cachedState = null;

function initFiles() {
  const config = getConfig();

  // Initialize lock-state.json
  if (!fs.existsSync(config.stateFilePath)) {
    fs.writeFileSync(config.stateFilePath, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
    console.log(`Created ${config.stateFilePath}`);
  }

  // Initialize lock-history.json
  if (!fs.existsSync(config.historyFilePath)) {
    fs.writeFileSync(config.historyFilePath, JSON.stringify([], null, 2), 'utf8');
    console.log(`Created ${config.historyFilePath}`);
  }

  // Populate cache
  cachedState = readStateFromDisk();
}

function readStateFromDisk() {
  const config = getConfig();
  try {
    const raw = fs.readFileSync(config.stateFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('WARNING: Could not read lock-state.json, using default state:', err.message);
    return { ...DEFAULT_STATE };
  }
}

function readState() {
  if (cachedState === null) {
    cachedState = readStateFromDisk();
  }
  return { ...cachedState };
}

function writeState(stateObject) {
  const config = getConfig();
  const normalized = {
    locked: stateObject.locked ?? false,
    holder: stateObject.holder ?? null,
    since: stateObject.since ?? null,
    commitMessage: stateObject.commitMessage ?? null,
    queue: stateObject.queue ?? [],
    lastActivity: stateObject.lastActivity ?? null
  };
  try {
    fs.writeFileSync(config.stateFilePath, JSON.stringify(normalized, null, 2), 'utf8');
    cachedState = { ...normalized };
  } catch (err) {
    console.error('ERROR: Failed to write lock-state.json:', err.message);
    // Keep cache in sync even if disk write failed
    cachedState = { ...normalized };
  }
}

function appendHistory(entry) {
  const config = getConfig();
  try {
    let history = [];
    if (fs.existsSync(config.historyFilePath)) {
      try {
        history = JSON.parse(fs.readFileSync(config.historyFilePath, 'utf8'));
      } catch {
        history = [];
      }
    }
    history.push(entry);
    // Trim to prevent unbounded growth
    if (history.length > 1000) {
      history = history.slice(history.length - 500);
    }
    fs.writeFileSync(config.historyFilePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('ERROR: Failed to write lock-history.json:', err.message);
  }
}

function readHistory(limit = 50) {
  const config = getConfig();
  try {
    if (!fs.existsSync(config.historyFilePath)) return [];
    const history = JSON.parse(fs.readFileSync(config.historyFilePath, 'utf8'));
    return history.slice(-limit).reverse();
  } catch {
    return [];
  }
}

module.exports = { initFiles, readState, writeState, appendHistory, readHistory };
