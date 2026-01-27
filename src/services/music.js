const { DisTube } = require('distube');
const { YouTubePlugin } = require('@distube/youtube');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MusicService {
  constructor(client) {
    this.client = client;
    this.distube = new DisTube(client, {
      emitNewSongOnly: true,
      plugins: [new YouTubePlugin()],
    });

    this.setupEvents();
  }

  setupEvents() {
    this.distube.on('playSong', (queue, song) => {
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 재생 시작')
        .setDescription(`[${song.name}](${song.url})`)
        .addFields(
          { name: '길이', value: song.formattedDuration, inline: true },
          { name: '요청자', value: song.user?.tag || '알 수 없음', inline: true }
        );
      if (song.thumbnail) embed.setThumbnail(song.thumbnail);
      queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
    });

    this.distube.on('addSong', (queue, song) => {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('➕ 대기열에 추가')
        .setDescription(`[${song.name}](${song.url})`)
        .addFields(
          { name: '길이', value: song.formattedDuration, inline: true },
          { name: '대기열', value: `${queue.songs.length}번째`, inline: true }
        );
      if (song.thumbnail) embed.setThumbnail(song.thumbnail);
      queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
    });

    this.distube.on('finish', (queue) => {
      queue.textChannel?.send('🔇 대기열의 모든 곡이 끝났습니다.').catch(() => {});
    });

    this.distube.on('disconnect', (queue) => {
      queue.textChannel?.send('👋 음성 채널에서 퇴장했습니다.').catch(() => {});
    });

    this.distube.on('error', (channel, error) => {
      logger.error('DisTube 에러:', error);
      channel?.send(`❌ 오류: ${error.message}`).catch(() => {});
    });
  }

  async play(message, query) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ 먼저 음성 채널에 접속해주세요.');
    }

    try {
      await this.distube.play(voiceChannel, query, {
        member: message.member,
        textChannel: message.channel,
        message,
      });
    } catch (error) {
      logger.error('재생 실패:', error);
      return message.reply(`❌ 재생 실패: ${error.message}`);
    }
  }

  async skip(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    const song = queue.songs[0];
    await queue.skip();
    await message.reply(`⏭️ 스킵: **${song.name}**`);
  }

  async stop(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    await queue.stop();
    await message.reply('⏹️ 재생을 정지하고 퇴장합니다.');
  }

  async pause(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    if (queue.paused) {
      return message.reply('❌ 이미 일시정지 상태입니다.');
    }
    queue.pause();
    await message.reply('⏸️ 일시정지했습니다.');
  }

  async resume(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    if (!queue.paused) {
      return message.reply('❌ 일시정지 상태가 아닙니다.');
    }
    queue.resume();
    await message.reply('▶️ 다시 재생합니다.');
  }

  async queue(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue || queue.songs.length === 0) {
      return message.reply('❌ 대기열이 비어있습니다.');
    }

    const current = queue.songs[0];
    let description = `**현재 재생 중:**\n🎵 [${current.name}](${current.url}) - ${current.formattedDuration}\n`;

    if (queue.songs.length > 1) {
      description += '\n**대기열:**\n';
      queue.songs.slice(1, 11).forEach((song, i) => {
        description += `${i + 1}. [${song.name}](${song.url}) - ${song.formattedDuration}\n`;
      });
      if (queue.songs.length > 11) {
        description += `\n... 그 외 ${queue.songs.length - 11}곡`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('📋 대기열')
      .setDescription(description)
      .setFooter({ text: `총 ${queue.songs.length}곡` });

    await message.reply({ embeds: [embed] });
  }

  async nowPlaying(message) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue || !queue.songs[0]) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const song = queue.songs[0];
    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 현재 재생 중')
      .setDescription(`[${song.name}](${song.url})`)
      .addFields(
        { name: '길이', value: song.formattedDuration, inline: true },
        { name: '요청자', value: song.user?.tag || '알 수 없음', inline: true }
      );
    if (song.thumbnail) embed.setThumbnail(song.thumbnail);

    await message.reply({ embeds: [embed] });
  }

  async volume(message, vol) {
    const queue = this.distube.getQueue(message.guildId);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const volume = parseInt(vol);
    if (isNaN(volume) || volume < 0 || volume > 100) {
      return message.reply('❌ 음량은 0~100 사이로 지정해주세요.');
    }

    queue.setVolume(volume);
    await message.reply(`🔊 음량: **${volume}%**`);
  }
}

module.exports = MusicService;
