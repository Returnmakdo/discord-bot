const { formatExpNumber } = require('./format');

// 히스토리 텍스트 생성
function generateHistoryText(history, characterName, worldName) {
  let text = `**${characterName}** - ${worldName}\n\`\`\`\n`;

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    let dateStr;

    if (h.date === 'NOW') {
      dateStr = 'NOW      ';
    } else {
      const date = new Date(h.date);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      dateStr = `${month}월 ${day}일`;
    }

    let expGainText = '';
    if (i > 0) {
      const expDiff = history[i].exp - history[i - 1].exp;
      if (expDiff > 0) {
        expGainText = ` (${formatExpNumber(expDiff)})`;
      } else {
        expGainText = ` (+0)`;
      }
    }

    text += `${dateStr} : Lv.${h.level} ${h.expRate.toFixed(3)}%${expGainText}\n`;
  }

  text += `\`\`\``;
  return text;
}

module.exports = { generateHistoryText };
