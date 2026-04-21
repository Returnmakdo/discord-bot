const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags
} = require('discord.js');
const logger = require('../utils/logger');
const { formatExpNumber } = require('../utils/format');
const { generateChartUrl } = require('../utils/chart');
const { generateHistoryText } = require('../utils/expStats');

const builder = new SlashCommandBuilder()
  .setName('경험치')
  .setDescription('메이플스토리 캐릭터의 최근 10일간 경험치 히스토리를 조회합니다')
  .addStringOption(option =>
    option
      .setName('캐릭터')
      .setDescription('조회할 캐릭터 닉네임')
      .setRequired(true)
  );

async function execute(interaction, { nexonApi }) {
  const characterName = interaction.options.getString('캐릭터', true);
  try {
    await interaction.deferReply();

    // 1. OCID 조회
    const ocid = await nexonApi.getCharacterOcid(characterName);
    if (!ocid) {
      return interaction.editReply(`❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`);
    }

    // 2. 기본 정보 조회
    const basicInfo = await nexonApi.getCharacterBasic(ocid);

    // 3. 경험치 히스토리 조회 (최근 10일)
    const history = await nexonApi.getExpHistoryRange(ocid, 10);

    if (history.length < 2) {
      return interaction.editReply(`❌ "${characterName}"의 경험치 히스토리 데이터가 충분하지 않습니다.`);
    }

    // 4. 경험치 변화량 계산
    const changes = nexonApi.calculateExpChanges(history);

    // 5. 상세 히스토리 텍스트 생성
    const historyText = generateHistoryText(history, characterName, basicInfo.world_name);

    // 6. 통계 계산
    const totalExpGain = changes.reduce((sum, c) => sum + c.expGain, 0);
    const avgExpGain = changes.length > 0 ? totalExpGain / changes.length : 0;

    // 일평균 경험치
    const expChanges = [];
    for (let i = 1; i < history.length; i++) {
      const diff = history[i].exp - history[i - 1].exp;
      if (diff > 0) expChanges.push(diff);
    }
    const avgExp = expChanges.length > 0
      ? expChanges.reduce((a, b) => a + b, 0) / expChanges.length
      : 0;

    // 남은 경험치 계산 (현재 레벨에서 100%까지)
    const currentExp = history[history.length - 1]?.exp || 0;
    const currentExpRate = history[history.length - 1]?.expRate || 0;
    const remainingExpRate = 100 - currentExpRate;
    const totalExpForLevel = currentExpRate > 0 ? (currentExp / currentExpRate) * 100 : 0;
    const remainingExp = totalExpForLevel - currentExp;

    // 예상 레벨업 날짜 계산
    let levelUpDateText = '계산 불가';
    if (avgExpGain > 0) {
      const daysToLevelUp = Math.ceil(remainingExpRate / avgExpGain);
      const levelUpDate = new Date();
      levelUpDate.setDate(levelUpDate.getDate() + daysToLevelUp);
      const year = String(levelUpDate.getFullYear()).slice(2);
      const month = String(levelUpDate.getMonth() + 1).padStart(2, '0');
      const day = String(levelUpDate.getDate()).padStart(2, '0');
      levelUpDateText = `${year}년 ${month}월 ${day}일 (${daysToLevelUp}일 후)`;
    }

    // 7. QuickChart.io로 그래프 생성 (경험치율 히스토리)
    const chartUrl = generateChartUrl(history);

    // 8. Embed 생성
    const embed = new EmbedBuilder()
      .setColor(0xFF9900)
      .setTitle('🍁 메이플스토리 경험치 히스토리')
      .setDescription(historyText)
      .addFields(
        { name: '📊 일일 평균 획득량', value: `${formatExpNumber(avgExp).replace('+', '')} (${avgExpGain.toFixed(2)}%)`, inline: true },
        { name: '📦 남은 경험치량', value: `${formatExpNumber(remainingExp).replace('+', '')} (${remainingExpRate.toFixed(2)}%)`, inline: true },
        { name: '📅 예상 레벨업 날짜', value: levelUpDateText, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Nexon Open API' });

    // 길드 정보가 있으면 추가
    if (basicInfo.character_guild_name) {
      embed.addFields({ name: '🎮 길드', value: basicInfo.character_guild_name, inline: true });
    }

    // 그래프 이미지 다운로드 후 Embed에 첨부
    const chartResponse = await fetch(chartUrl);
    const chartBuffer = Buffer.from(await chartResponse.arrayBuffer());
    const attachment = new AttachmentBuilder(chartBuffer, { name: 'exp_chart.png' });
    embed.setImage('attachment://exp_chart.png');

    await interaction.editReply({ content: '', embeds: [embed], files: [attachment] });
    logger.info(`경험치 조회 완료: ${characterName}`);

  } catch (error) {
    logger.error(`경험치 조회 실패 (${characterName}):`, error);

    let errorMessage = '❌ 경험치 조회 중 오류가 발생했습니다.';
    if (error.message.includes('400')) {
      errorMessage = `❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`;
    } else if (error.message.includes('429')) {
      errorMessage = '❌ API 요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.';
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

module.exports = {
  builder,
  allowedChannelEnv: 'CHANNEL_ID_EXP',
  execute,
};
