const { logger } = require('./utils/logger');
const { Keyv } = require('keyv');
const { keyvUrl } = require('./config');

const db = new Keyv(keyvUrl);
db.on('error', (err) => console.error('Keyv connection error:', err));

module.exports = { db };
