const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const ffmpegPath = require('ffmpeg-static');
const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

// FFmpeg 경로 설정
process.env.FFMPEG_PATH = ffmpegPath;

class MusicService {
  constructor() {
    // 길드별 큐 관리: { guildId: { queue: [], player, connection, current, volume } }
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

  // 재생
  async play(message, query) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ 먼저 음성 채널에 접속해주세요.');
    }

    const guildData = this.getGuildData(message.guild.id);
    guildData.textChannel = message.channel;

    // 검색
    let trackInfo;
    try {
      const isUrl = query.startsWith('http');
      let result;

      if (isUrl) {
        result = await play.search(query, { limit: 1 });
      } else {
        result = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
      }

      if (!result || result.length === 0) {
        return message.reply('❌ 검색 결과가 없습니다.');
      }

      // 디버깅: 검색 결과 확인
      logger.info(`검색 결과: ${JSON.stringify(result[0], null, 2)}`);

      trackInfo = {
        title: result[0].title,
        url: result[0].url,
        duration: result[0].durationRaw || '실시간',
        durationMs: result[0].durationInSec * 1000,
        thumbnail: result[0].thumbnails?.[0]?.url || null,
        author: result[0].channel?.name || '알 수 없음',
        requester: message.author.tag,
      };
    } catch (error) {
      logger.error('YouTube 검색 실패:', error);
      return message.reply('❌ 검색 중 오류가 발생했습니다.');
    }

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
          { name: '대기열 위치', value: `${guildData.queue.length}번째`, inline: true }
        );
      if (trackInfo.thumbnail) embed.setThumbnail(trackInfo.thumbnail);
      return message.reply({ embeds: [embed] });
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
        // 다음 곡 재생
        guildData.queue.shift();
        if (guildData.queue.length > 0) {
          this.playNext(message.guild.id);
        } else {
          guildData.current = null;
          if (guildData.textChannel) {
            guildData.textChannel.send('🔇 대기열의 모든 곡이 끝났습니다.').catch(() => {});
          }
          // 30초 후 자동 퇴장
          setTimeout(() => {
            const data = this.guilds.get(message.guild.id);
            if (data && data.queue.length === 0) {
              this.cleanup(message.guild.id);
            }
          }, 30000);
        }
      });

      guildData.player.on('error', (error) => {
        logger.error('오디오 플레이어 에러:', error);
        if (guildData.textChannel) {
          guildData.textChannel.send(`❌ 재생 오류: **${guildData.current?.title || '알 수 없음'}**`).catch(() => {});
        }
        guildData.queue.shift();
        if (guildData.queue.length > 0) {
          this.playNext(message.guild.id);
        }
      });

      guildData.connection.subscribe(guildData.player);
    }

    // 첫 곡 재생
    await this.playNext(message.guild.id);
  }

  async playNext(guildId) {
    const guildData = this.guilds.get(guildId);
    if (!guildData || guildData.queue.length === 0) return;

    const track = guildData.queue[0];
    guildData.current = track;

    try {
      // play-dl로 스트림 가져오기
      logger.info(`스트림 URL: ${track.url}`);
      const stream = await play.stream(track.url);
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
      });
      resource.volume?.setVolume(guildData.volume / 100);

      guildData.player.play(resource);
      guildData.currentResource = resource;

      // 재생 시작 알림
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎵 재생 시작')
        .setDescription(`[${track.title}](${track.url})`)
        .addFields(
          { name: '아티스트', value: track.author, inline: true },
          { name: '길이', value: track.duration, inline: true }
        );
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);

      if (guildData.textChannel) {
        guildData.textChannel.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (error) {
      logger.error(`트랙 스트림 실패: ${track.title}`, error);
      if (guildData.textChannel) {
        guildData.textChannel.send(`❌ 스트림 오류: **${track.title}**`).catch(() => {});
      }
      guildData.queue.shift();
      if (guildData.queue.length > 0) {
        await this.playNext(guildId);
      }
    }
  }

  // 스킵
  async skip(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.player || guildData.player.state.status === AudioPlayerStatus.Idle) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    const title = guildData.current?.title || '알 수 없음';
    guildData.player.stop(); // Idle 이벤트가 트리거되어 다음 곡 재생
    await message.reply(`⏭️ 스킵: **${title}**`);
  }

  // 정지 + 퇴장
  async stop(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.connection) {
      return message.reply('❌ 현재 재생 중인 곡이 없습니다.');
    }

    this.cleanup(message.guild.id);
    await message.reply('⏹️ 재생을 정지하고 퇴장합니다.');
  }

  // 일시정지
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

  // 재개
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

  // 대기열 표시
  async queue(message) {
    const guildData = this.guilds.get(message.guild.id);
    if (!guildData?.current) {
      return message.reply('❌ 대기열이 비어있습니다.');
    }

    let description = `**현재 재생 중:**\n🎵 [${guildData.current.title}](${guildData.current.url}) - ${guildData.current.duration}\n`;

    const upcoming = guildData.queue.slice(1);
    if (upcoming.length > 0) {
      description += '\n**대기열:**\n';
      const display = upcoming.slice(0, 10);
      display.forEach((track, i) => {
        description += `${i + 1}. [${track.title}](${track.url}) - ${track.duration}\n`;
      });
      if (upcoming.length > 10) {
        description += `\n... 그 외 ${upcoming.length - 10}곡`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('📋 대기열')
      .setDescription(description)
      .setFooter({ text: `총 ${guildData.queue.length}곡` });

    await message.reply({ embeds: [embed] });
  }

  // 현재곡
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
        { name: '요청자', value: track.requester, inline: true }
      );
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    await message.reply({ embeds: [embed] });
  }

  // 볼륨
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
    if (guildData.currentResource?.volume) {
      guildData.currentResource.volume.setVolume(volume / 100);
    }
    await message.reply(`🔊 음량: **${volume}%**`);
  }

  // 정리
  cleanup(guildId) {
    const guildData = this.guilds.get(guildId);
    if (!guildData) return;

    if (guildData.player) {
      guildData.player.stop(true);
    }
    if (guildData.connection) {
      guildData.connection.destroy();
    }
    this.guilds.delete(guildId);
  }
}

module.exports = MusicService;
