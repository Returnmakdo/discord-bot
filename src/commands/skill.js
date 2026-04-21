const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const logger = require('../utils/logger');
const skillCalculator = require('../services/skillCalculator');

const BUTTON_PREFIX = 'skill_core:';
const MODAL_PREFIX = 'skill_modal:';

const builder = new SlashCommandBuilder()
  .setName('6차')
  .setDescription('6차 스킬 강화 비용 계산기');

// 6차 스킬 강화 계산기 UI 전송
async function execute(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0x007bff)
      .setTitle('🔮 6차 스킬 강화 비용 계산기')
      .setDescription('강화할 코어 종류를 선택하면 현재/목표 레벨을 입력할 수 있어요.')
      .addFields(
        { name: '📦 코어 종류', value: '스킬 / 강화 / 마스터리 / 공용 / 3rd 공용', inline: false },
        { name: '📊 결과', value: '필요한 **솔 에르다** 및 **솔 에르다 조각** 수량', inline: false }
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}skill`).setLabel('스킬 코어').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}enhancement`).setLabel('강화 코어').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}mastery`).setLabel('마스터리 코어').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}common`).setLabel('공용 코어').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}third_common`).setLabel('3rd 공용 코어').setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [embed], components: [row1, row2] });
  } catch (error) {
    logger.error('6차 계산기 UI 전송 실패:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ 계산기 UI를 불러오지 못했습니다.').catch(() => {});
    } else {
      await interaction.reply({ content: '❌ 계산기 UI를 불러오지 못했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function ownsButton(customId) {
  return customId.startsWith(BUTTON_PREFIX);
}

// 코어 버튼 → Modal 팝업
async function handleButton(interaction) {
  const coreId = interaction.customId.slice(BUTTON_PREFIX.length);
  const label = skillCalculator.coreLabels[coreId];
  if (!label) {
    return interaction.reply({ content: '❌ 알 수 없는 코어 종류입니다.', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${coreId}`)
    .setTitle(`${label} 강화 비용 계산`);

  const currentInput = new TextInputBuilder()
    .setCustomId('current_level')
    .setLabel('현재 레벨 (0 ~ 29)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: 0')
    .setRequired(true)
    .setMaxLength(2);

  const targetInput = new TextInputBuilder()
    .setCustomId('target_level')
    .setLabel('목표 레벨 (1 ~ 30)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('예: 30')
    .setRequired(true)
    .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder().addComponents(currentInput),
    new ActionRowBuilder().addComponents(targetInput)
  );

  await interaction.showModal(modal);
}

function ownsModal(customId) {
  return customId.startsWith(MODAL_PREFIX);
}

// Modal 제출 → 결과 embed 응답
async function handleModal(interaction) {
  const coreId = interaction.customId.slice(MODAL_PREFIX.length);
  const label = skillCalculator.coreLabels[coreId];
  const currentRaw = interaction.fields.getTextInputValue('current_level').trim();
  const targetRaw = interaction.fields.getTextInputValue('target_level').trim();
  const currentLevel = Number.parseInt(currentRaw, 10);
  const targetLevel = Number.parseInt(targetRaw, 10);

  try {
    const { totalErda, totalFragment } = skillCalculator.calculate(coreId, currentLevel, targetLevel);

    const embed = new EmbedBuilder()
      .setColor(0x28a745)
      .setTitle(`🔮 ${label} 강화 비용`)
      .setDescription(`**Lv.${currentLevel} → Lv.${targetLevel}** 강화에 필요한 재화`)
      .addFields(
        { name: '☀️ 솔 에르다', value: `**${totalErda.toLocaleString('ko-KR')}** 개`, inline: true },
        { name: '✨ 솔 에르다 조각', value: `**${totalFragment.toLocaleString('ko-KR')}** 개`, inline: true }
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    logger.info(`6차 계산: ${label} ${currentLevel}→${targetLevel} = 에르다 ${totalErda}, 조각 ${totalFragment}`);
  } catch (error) {
    await interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  builder,
  allowedChannelEnv: 'CHANNEL_ID_SKILL',
  execute,
  ownsButton,
  handleButton,
  ownsModal,
  handleModal,
};
