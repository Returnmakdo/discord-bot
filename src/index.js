require('dotenv').config();
const MapleBot = require('./bot');
const logger = require('./utils/logger');

const bot = new MapleBot();
bot.init().catch(error => {
  logger.error('봇 실행 실패:', error);
  process.exit(1);
});
