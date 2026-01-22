const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const NexonApi = require('../services/nexonApi');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('닉네임')
    .setDescription('캐릭터의 최근 10일 경험치 히스토리를 조회합니다')
    .addStringOption(option =>
      option.setName('캐릭터')
        .setDescription('조회할 캐릭터 닉네임')
        .setRequired(true)
    ),

  async execute(interaction) {
    // 허용된 채널에서만 실행
    const allowedChannel = process.env.CHANNEL_ID_EXP;
    if (allowedChannel && interaction.channelId !== allowedChannel) {
      return await interaction.reply({
        content: `❌ 이 명령어는 <#${allowedChannel}> 채널에서만 사용할 수 있습니다.`,
        ephemeral: true
      });
    }

    const characterName = interaction.options.getString('캐릭터');

    await interaction.deferReply();

    try {
      const nexonApi = new NexonApi();

      // 1. OCID 조회
      const ocid = await nexonApi.getCharacterOcid(characterName);
      if (!ocid) {
        return await interaction.editReply({
          content: `❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`
        });
      }

      // 2. 기본 정보 조회
      const basicInfo = await nexonApi.getCharacterBasic(ocid);

      // 3. 경험치 히스토리 조회 (최근 10일)
      const history = await nexonApi.getExpHistoryRange(ocid, 10);

      if (history.length < 2) {
        return await interaction.editReply({
          content: `❌ "${characterName}"의 경험치 히스토리 데이터가 충분하지 않습니다.`
        });
      }

      // 4. 경험치 변화량 계산
      const changes = nexonApi.calculateExpChanges(history);

      // 5. 통계 계산
      const totalExpGain = changes.reduce((sum, c) => sum + c.expGain, 0);
      const avgExpGain = totalExpGain / changes.length;

      // 6. QuickChart.io로 그래프 생성
      const chartUrl = this.generateChartUrl(changes);

      // 7. Embed 생성
      const embed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('🍁 메이플스토리 경험치 히스토리')
        .setDescription(`**📊 ${characterName}**\n${basicInfo.world_name} | Lv.${basicInfo.character_level} ${basicInfo.character_class}`)
        .addFields(
          { name: '─────────────────────', value: '\u200B', inline: false },
          { name: '📈 10일간 총 획득', value: `${totalExpGain.toFixed(2)}%`, inline: true },
          { name: '📊 일평균 획득', value: `${avgExpGain.toFixed(2)}%`, inline: true }
        )
        .setImage(chartUrl)
        .setTimestamp()
        .setFooter({ text: 'Nexon Open API' });

      // 길드 정보가 있으면 추가
      if (basicInfo.character_guild_name) {
        embed.addFields({ name: '🎮 길드', value: basicInfo.character_guild_name, inline: true });
      }

      await interaction.editReply({ embeds: [embed] });
      logger.info(`경험치 조회 완료: ${characterName}`);

    } catch (error) {
      logger.error(`경험치 조회 실패 (${characterName}):`, error);

      let errorMessage = '❌ 경험치 조회 중 오류가 발생했습니다.';
      if (error.message.includes('400')) {
        errorMessage = `❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`;
      } else if (error.message.includes('429')) {
        errorMessage = '❌ API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
      }

      await interaction.editReply({ content: errorMessage });
    }
  },

  // QuickChart.io URL 생성
  generateChartUrl(changes) {
    const labels = changes.map(c => {
      if (c.date === 'NOW') return 'NOW';
      const date = new Date(c.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const data = changes.map(c => c.expGain.toFixed(2));

    const chartConfig = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '일일 경험치 획득량 (%)',
          data: data,
          fill: true,
          backgroundColor: 'rgba(255, 153, 0, 0.2)',
          borderColor: 'rgb(255, 153, 0)',
          borderWidth: 2,
          tension: 0.3,
          pointBackgroundColor: 'rgb(255, 153, 0)',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#ffffff',
              font: { size: 12 }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          }
        }
      }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}&backgroundColor=%23303030&width=500&height=300`;
  }
};
