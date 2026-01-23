const { EmbedBuilder, WebhookClient } = require('discord.js');
const logger = require('../utils/logger');

class DiscordService {
  constructor(client) {
    this.client = client;
    // 단일 채널 사용 (CHANNEL_ID_UPDATE로 모든 공지사항 전송)
    this.channelId = process.env.CHANNEL_ID_UPDATE;
    
    // 카테고리별 색상
    this.colors = {
      update: 0xFF6B00,      // 주황색
      maintenance: 0xFF0000,  // 빨간색
      event: 0x00D9FF,        // 하늘색
      notice: 0xFFD700        // 금색
    };

    // 카테고리별 이모지
    this.emojis = {
      update: '🔄',
      maintenance: '🔧',
      event: '🎉',
      notice: '📢'
    };
  }

  // 채널 ID 반환 (모든 공지사항이 동일 채널로 전송)
  getChannelId() {
    return this.channelId;
  }

  // Embed 메시지 생성
  createEmbed(notice) {
    const emoji = this.emojis[notice.category] || '📢';
    const color = this.colors[notice.category] || 0xFFD700;

    const categoryNames = {
      update: '🔄 업데이트',
      maintenance: '🔧 점검 공지',
      event: '🎉 이벤트',
      notice: '📢 일반 공지'
    };

    const dateLabel = notice.category === 'event' ? '📅 기간' : '📅 작성일';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({
        name: '🍁 메이플스토리 공식'
      })
      .setTitle(`${emoji} ${notice.title}`)
      .setURL(notice.link)
      .addFields(
        {
          name: '📋 분류',
          value: `\`${categoryNames[notice.category]}\``,
          inline: true
        },
        {
          name: dateLabel,
          value: `\`${notice.date}\``,
          inline: true
        },
        {
          name: '🔗 바로가기',
          value: `[공식 페이지에서 보기](${notice.link})`,
          inline: true
        }
      )
      .setFooter({
        text: '🍁 메이플스토리 공식 홈페이지'
      })
      .setTimestamp();

    // 내용이 있으면 깔끔하게 표시
    if (notice.content) {
      // 줄바꿈을 유지하면서 표시
      let formattedContent = notice.content;

      // 너무 길면 자르기
      if (formattedContent.length > 800) {
        formattedContent = formattedContent.substring(0, 800) + '\n...';
      }

      embed.setDescription(formattedContent);
    }

    return embed;
  }

  // 메시지 전송
  async sendNotice(notice) {
    try {
      const channelId = this.getChannelId();
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        logger.error(`채널을 찾을 수 없음: ${channelId}`);
        return false;
      }

      const embed = this.createEmbed(notice);
      await channel.send({ embeds: [embed] });

      // 이벤트 이미지가 있으면 embed 뒤에 첨부파일로 전송
      if (notice.image) {
        await channel.send({ files: [notice.image] });
      }

      logger.info(`메시지 전송 완료: [${notice.category}] ${notice.title}`);
      return true;
    } catch (error) {
      logger.error(`메시지 전송 실패: ${error.message}`, error);
      return false;
    }
  }

  // 여러 공지사항 일괄 전송
  async sendBatch(notices) {
    const results = await Promise.allSettled(
      notices.map(notice => this.sendNotice(notice))
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    logger.info(`일괄 전송 완료: ${successCount}/${notices.length}`);

    return successCount;
  }

  // 에러 알림 전송 (관리자용)
  async sendError(error) {
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚠️ 봇 에러 발생')
        .setDescription(`\`\`\`${error.message}\`\`\``)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error('에러 알림 전송 실패:', err);
    }
  }

  // 시작 메시지
  async sendStartMessage() {
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ 메이플 알리미 봇 시작')
        .setDescription('메이플스토리 업데이트를 자동으로 알려드립니다!')
        .addFields(
          { 
            name: '체크 주기', 
            value: `${process.env.CHECK_INTERVAL / 60000}분마다`, 
            inline: true 
          },
          { 
            name: '감지 항목', 
            value: '공지사항, 업데이트, 점검, 이벤트', 
            inline: true 
          }
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      logger.info('시작 메시지 전송 완료');
    } catch (error) {
      logger.error('시작 메시지 전송 실패:', error);
    }
  }
}

module.exports = DiscordService;
