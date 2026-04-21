const { MessageFlags } = require('discord.js');
const exp = require('./exp');
const skill = require('./skill');

const all = [exp, skill];

// 인터랙션 라우팅: 슬래시 / 버튼 / Modal 을 각 명령어 모듈로 위임
async function route(interaction, ctx) {
  if (interaction.isChatInputCommand()) {
    const cmd = all.find(c => c.builder.name === interaction.commandName);
    if (!cmd) return;

    if (cmd.allowedChannelEnv) {
      const allowedChannel = process.env[cmd.allowedChannelEnv];
      if (allowedChannel && interaction.channelId !== allowedChannel) {
        return interaction.reply({
          content: `❌ 이 명령어는 <#${allowedChannel}> 채널에서만 사용할 수 있어요.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    return cmd.execute(interaction, ctx);
  }

  if (interaction.isButton()) {
    const cmd = all.find(c => typeof c.ownsButton === 'function' && c.ownsButton(interaction.customId));
    if (cmd) return cmd.handleButton(interaction, ctx);
    return;
  }

  if (interaction.isModalSubmit()) {
    const cmd = all.find(c => typeof c.ownsModal === 'function' && c.ownsModal(interaction.customId));
    if (cmd) return cmd.handleModal(interaction, ctx);
    return;
  }
}

module.exports = {
  all,
  buildersJson: all.map(c => c.builder.toJSON()),
  route,
};
