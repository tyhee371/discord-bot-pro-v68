// Barrel re-export for src/stores/
// Use: const { getGuildSettings } = require('../stores');
// Or import individual files directly: require('../stores/settings')
module.exports = {
  ...require('./settings'),
  ...require('./prefixStore'),
};
