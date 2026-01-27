const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MusicService {
  constructor(client) {
    this.client = client;
    this.guilds = new Map();
  }

  getGuildData(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, {
        queue: [],
        player: null,
        connection: null,
        current: null,
        volume: 50,
        textChannel: null,
      });
    }
    return this.guilds.get(guildId);
  }

  async play(message, query) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ 먼저 음성 채널에 접속해주세요.');
    }

    const guildData = this.getGuildData(message.guild.id);
    guildData.textChannel = message.channel;

    // 검색 또는 URL
    let trackInfo;
    try {
      await message.reply('🔍 검색 중...');
      trackInfo = await this.getTrackInfo(query);
      if (!trackInfo) {
        return message.channel.send('❌ 검색 결과가 없습니다.');
      }
    } catch (error) {
      logger.error('검색 실패:', error);
      return message.channel.send('❌ 검색 중 오류가 발생했습니다.');
    }

    trackInfo.requester = message.author.tag;
    guildData.queue.push(trackInfo);

    // 이미 재생 중이면 큐에 추가만
    if (guildData.player && guildData.player.state.status !== AudioPlayerStatus.Idle) {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('➕ 대기열에 추가')
        .setDescription(`[${trackInfo.title}](${trackInfo.url})`)
        .addFields(
          { name: '아티스트', value: trackInfo.author, inline: true },
          { name: '길이', value: trackInfo.duration, inline: true },
          { name: '대기열', value: `${guildData.queue.length}번째`, inline: true }
        );
      if (trackInfo.thumbnail) embed.setThumbnail(trackInfo.thumbnail);
      return message.channel.send({ embeds: [embed] });
    }

    // 음성 채널 접속
    if (!guildData.connection) {
      guildData.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      guildData.connection.on(VoiceConnectionStatus.Disconnected, () => {
        this.cleanup(message.guild.id);
      });
    }

    // 플레이어 생성
    if (!guildData.player) {
      guildData.player = createAudioPlayer();

      guildData.player.on(AudioPlayerStatus.Idle, () => {
        guildData.queue.shift();
        if (guildData.queue.length > 0) {
          this.playNext(message.guild.id);
        } else {
          guildData.current = null;
          guildData.textChannel?.send('🔇 대기열의 모든 곡이 끝났습니다.').catch(() => {});
          setTimeout(() => {
            const data = this.guilds.get(message.guild.id);
            if (data && data.queue.length === 0) {
              this.cleanup(message.guild.id);
            }
          }, 30000);
        }
      });

      guildData.player.on('error', (error) => {
        logger.error('플레이어 에러:', error);
        guildData.textChannel?.send(`❌ 재생 오류가 발생했습니다.`).catch(() => {});
        guildData.queue.shift();
        if (guildData.queue.length > 0) {
          this.playNext(message.guild.id);
        }
      });

      guildData.connection.subscribe(guildData.player);
    }

    await this.playNext(message.guild.id);
  }

  // yt-dlp로 트랙 정보 가져오기
  getTrackInfo(query) {
    return new Promise((resolve, reject) => {
      const isUrl = query.startsWith('http');
      const args = [
        '--dump-json',
        '--no-playlist',
        '--default-search', 'ytsearch',
        isUrl ? query : `ytsearch:${query}`
      ];

      const ytdlp = spawn('yt-dlp', args);
      let output = '';
      let error = '';

      ytdlp.stdout.on('data', (data) => { output += data; });
      ytdlp.stderr.on('data', (data) => { error += data; });

      ytdlp.on('close', (code) => {
        if (code !== 0 || !output) {
          logger.error('yt-dlp 에러:', error);
          resolve(null);
          return;
        }

        try {
          const info = JSON.parse(output);
          resolve({
            title: info.title,
            url: info.webpage_url || info.url,
            duration: this.formatDuration(info.duration),
            thumbnail: info.thumbnail,
            author: info.uploader || info.channel || '알 수 없음',
          });
        } catch (e) {
          logger.error('JSON 파싱 에러:', e);
          resolve(null);
        }
      });
    });
  }

  formatDuration(seconds) {
    if (!seconds) return '실시간';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  async playNext(guildId) {
    const guildData = this.guilds.get(guildId);
    if (!guildData || guildData.queue.length === 0) return;

    const track = guildData.queue[0];
    guildData.current = track;

    try {
      // yt-dlp + ffmpeg로 스트림 생성
      const ytdlp = spawn('yt-dlp', [
        '-o', '-',
        '-f', 'bestaudio',
        '--no-playlist',
        track.url
      ]);

      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      ]);

      ytdlp.stdout.pipe(ffmpeg.stdin);

      ytdlp.stderr.on('data', (data) => {
        logger.debug('yt-dlp:', data.toString());
      });

      const resource = createAudioResource(ffmpeg.stdout, {
        inlineVolume: true,
      });
      resource.volume?.setVolume(guildData.volume / 100);

      guildData.player.play(resource);

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 재생 시작')
        .setDescription(`[${track.title}](${track.url})`)
        .addFields(
          { name: '아티스트', value: track.author, inline: true },
          { name: '길이', value: track.duration, inline: true }
        );
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);

      guildData.textChannel?.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
      logger.error('스트림 실패:', error);
      guildData.textChannel?.send(`❌ 스트림 오류: **${track.title}**`).catch(() => {});
      guildData.queue.shift();
      if (guildData.queue.length > 0) {
        await this.playNext(guildId);
      }
    }
  }

  async skip(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.player || guildData.player.state.status === AudioPlayerStatus.Idle) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    const title = guildData.current?.title || '알 수 없음';
    guildData.player.stop();
    await message.reply(`⏭️ 스킵: **${title}**`);
  }

  async stop(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.connection) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    this.cleanup(message.guild.id);
    await message.reply('⏹️ 재생을 정지하고 퇴장합니다.');
  }

  async pause(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.player || guildData.player.state.status === AudioPlayerStatus.Idle) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    if (guildData.player.state.status === AudioPlayerStatus.Paused) {
      return message.reply('❌ 이미 일시정지 상태입니다.');
    }
    guildData.player.pause();
    await message.reply('⏸️ 일시정지했습니다.');
  }

  async resume(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.player) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }
    if (guildData.player.state.status !== AudioPlayerStatus.Paused) {
      return message.reply('❌ 일시정지 상태가 아닙니다.');
    }
    guildData.player.unpause();
    await message.reply('▶️ 다시 재생합니다.');
  }

  async queue(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.current) {
      return message.reply('❌ 대기열이 비어있습니다.');
    }

    let description = `**현재 재생 중:**\n🎵 [${guildData.current.title}](${guildData.current.url}) - ${guildData.current.duration}\n`;

    const tracks = guildData.queue.slice(1);
    if (tracks.length > 0) {
      description += '\n**대기열:**\n';
      tracks.slice(0, 10).forEach((track, i) => {
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
      .setFooter({ text: `총 ${guildData.queue.length}곡` });

    await message.reply({ embeds: [embed] });
  }

  async nowPlaying(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.current) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const track = guildData.current;
    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 현재 재생 중')
      .setDescription(`[${track.title}](${track.url})`)
      .addFields(
        { name: '아티스트', value: track.author, inline: true },
        { name: '길이', value: track.duration, inline: true },
        { name: '요청자', value: track.requester || '알 수 없음', inline: true }
      );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    await message.reply({ embeds: [embed] });
  }

  async volume(message, vol) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.player || guildData.player.state.status === AudioPlayerStatus.Idle) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const volume = parseInt(vol);
    if (isNaN(volume) || volume < 0 || volume > 100) {
      return message.reply('❌ 음량은 0~100 사이로 지정해주세요.');
    }

    guildData.volume = volume;
    await message.reply(`🔊 음량: **${volume}%**`);
  }

  cleanup(guildId) {
    const guildData = this.guilds.get(guildId);
    if (!guildData) return;

    if (guildData.player) guildData.player.stop(true);
    if (guildData.connection) guildData.connection.destroy();
    this.guilds.delete(guildId);
  }
}

module.exports = MusicService;
