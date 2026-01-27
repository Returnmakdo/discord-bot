const { Player } = require('discord-player');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MusicService {
  constructor(client) {
    this.client = client;
    this.player = null;
    this.init();
  }

  async init() {
    try {
      this.player = new Player(this.client, {
        ytdlOptions: {
          quality: 'highestaudio',
          highWaterMark: 1 << 25,
        }
      });

      // extractor 로드
      await this.player.extractors.loadDefault();

      // 이벤트 핸들러
      this.player.events.on('playerStart', (queue, track) => {
        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎵 재생 시작')
          .setDescription(`[${track.title}](${track.url})`)
          .addFields(
            { name: '아티스트', value: track.author || '알 수 없음', inline: true },
            { name: '길이', value: track.duration || '알 수 없음', inline: true }
          );
        if (track.thumbnail) embed.setThumbnail(track.thumbnail);
        queue.metadata.channel.send({ embeds: [embed] }).catch(() => {});
      });

      this.player.events.on('audioTrackAdd', (queue, track) => {
        if (queue.tracks.size > 0) {
          const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('➕ 대기열에 추가')
            .setDescription(`[${track.title}](${track.url})`)
            .addFields(
              { name: '아티스트', value: track.author || '알 수 없음', inline: true },
              { name: '길이', value: track.duration || '알 수 없음', inline: true }
            );
          if (track.thumbnail) embed.setThumbnail(track.thumbnail);
          queue.metadata.channel.send({ embeds: [embed] }).catch(() => {});
        }
      });

      this.player.events.on('emptyQueue', (queue) => {
        queue.metadata.channel.send('🔇 대기열의 모든 곡이 끝났습니다.').catch(() => {});
      });

      this.player.events.on('playerError', (queue, error) => {
        logger.error('플레이어 에러:', error);
        queue.metadata.channel.send(`❌ 재생 오류가 발생했습니다.`).catch(() => {});
      });

      this.player.events.on('error', (queue, error) => {
        logger.error('큐 에러:', error);
      });

      logger.info('discord-player 초기화 완료');
    } catch (error) {
      logger.error('discord-player 초기화 실패:', error);
    }
  }

  async play(message, query) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ 먼저 음성 채널에 접속해주세요.');
    }

    if (!this.player) {
      return message.reply('❌ 음악 플레이어가 초기화되지 않았습니다.');
    }

    try {
      const searchResult = await this.player.search(query, {
        requestedBy: message.author,
      });

      if (!searchResult || !searchResult.tracks.length) {
        return message.reply('❌ 검색 결과가 없습니다.');
      }

      const { track } = await this.player.play(voiceChannel, searchResult, {
        nodeOptions: {
          metadata: {
            channel: message.channel,
            requestedBy: message.author,
          },
          volume: 50,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 30000,
          leaveOnEnd: true,
          leaveOnEndCooldown: 30000,
        },
      });

    } catch (error) {
      logger.error('재생 실패:', error);
      return message.reply('❌ 재생 중 오류가 발생했습니다.');
    }
  }

  async skip(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue || !queue.isPlaying()) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const title = queue.currentTrack?.title || '알 수 없음';
    queue.node.skip();
    await message.reply(`⏭️ 스킵: **${title}**`);
  }

  async stop(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    queue.delete();
    await message.reply('⏹️ 재생을 정지하고 퇴장합니다.');
  }

  async pause(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue || !queue.isPlaying()) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    if (queue.node.isPaused()) {
      return message.reply('❌ 이미 일시정지 상태입니다.');
    }

    queue.node.pause();
    await message.reply('⏸️ 일시정지했습니다.');
  }

  async resume(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    if (!queue.node.isPaused()) {
      return message.reply('❌ 일시정지 상태가 아닙니다.');
    }

    queue.node.resume();
    await message.reply('▶️ 다시 재생합니다.');
  }

  async queue(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue || !queue.currentTrack) {
      return message.reply('❌ 대기열이 비어있습니다.');
    }

    const current = queue.currentTrack;
    let description = `**현재 재생 중:**\n🎵 [${current.title}](${current.url}) - ${current.duration}\n`;

    const tracks = queue.tracks.toArray();
    if (tracks.length > 0) {
      description += '\n**대기열:**\n';
      const display = tracks.slice(0, 10);
      display.forEach((track, i) => {
        description += `${i + 1}. [${track.title}](${track.url}) - ${track.duration}\n`;
      });
      if (tracks.length > 10) {
        description += `\n... 그 외 ${tracks.length - 10}곡`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('📋 대기열')
      .setDescription(description)
      .setFooter({ text: `총 ${tracks.length + 1}곡` });

    await message.reply({ embeds: [embed] });
  }

  async nowPlaying(message) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue || !queue.currentTrack) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const track = queue.currentTrack;
    const progress = queue.node.createProgressBar();

    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 현재 재생 중')
      .setDescription(`[${track.title}](${track.url})`)
      .addFields(
        { name: '아티스트', value: track.author || '알 수 없음', inline: true },
        { name: '길이', value: track.duration || '알 수 없음', inline: true },
        { name: '진행', value: progress || '알 수 없음', inline: false }
      );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    await message.reply({ embeds: [embed] });
  }

  async volume(message, vol) {
    const queue = this.player?.nodes.get(message.guild.id);
    if (!queue || !queue.isPlaying()) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const volume = parseInt(vol);
    if (isNaN(volume) || volume < 0 || volume > 100) {
      return message.reply('❌ 음량은 0~100 사이로 지정해주세요.');
    }

    queue.node.setVolume(volume);
    await message.reply(`🔊 음량: **${volume}%**`);
  }
}

module.exports = MusicService;
