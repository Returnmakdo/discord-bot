require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const MapleCrawler = require('./services/crawler');
const DiscordService = require('./services/discord');
const Summarizer = require('./services/summarizer');
const NexonApi = require('./services/nexonApi');
const NoticeDB = require('./utils/database');
const logger = require('./utils/logger');
const fs = require('fs');
const path = require('path');

class MapleBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.crawler = new MapleCrawler();
    this.summarizer = new Summarizer();
    this.db = new NoticeDB();
    this.discord = null;
    this.checkInterval = parseInt(process.env.CHECK_INTERVAL) || 300000;
    this.intervalId = null;
    this.isRunning = false;
    this.isFirstRun = true; // 첫 실행 여부
    this.nexonApi = new NexonApi();
  }

  // 초기화
  async init() {
    try {
      // 필요한 디렉토리 생성
      this.ensureDirectories();

      // Discord 로그인
      await this.client.login(process.env.DISCORD_BOT_TOKEN);
      logger.info('Discord 로그인 성공');

      // Discord 서비스 초기화
      this.discord = new DiscordService(this.client);

      // 이벤트 핸들러 등록
      this.setupEventHandlers();

      // 사용법 안내 게시 (최초 1회)
      await this.postUsageGuide();

      // 주기적 체크 시작
      this.startPeriodicCheck();

      // 첫 체크 즉시 실행
      await this.checkUpdates();

    } catch (error) {
      logger.error('봇 초기화 실패:', error);
      process.exit(1);
    }
  }

  // 필요한 디렉토리 생성
  ensureDirectories() {
    const dirs = ['logs', 'data'];
    dirs.forEach(dir => {
      const dirPath = path.join(__dirname, '..', dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info(`디렉토리 생성: ${dirPath}`);
      }
    });
  }

  // 이벤트 핸들러 설정
  setupEventHandlers() {
    this.client.on('ready', () => {
      logger.info(`봇 준비 완료: ${this.client.user.tag}`);
      this.client.user.setActivity('메이플스토리 업데이트 감시 중', { type: 3 });
    });

    this.client.on('error', (error) => {
      logger.error('Discord 클라이언트 에러:', error);
    });

    // 메시지 명령어 처리 (!경험치 닉네임)
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!message.content.startsWith('!경험치')) return;

      // 채널 제한
      const allowedChannel = process.env.CHANNEL_ID_EXP;
      if (allowedChannel && message.channelId !== allowedChannel) {
        return;
      }

      const args = message.content.slice('!경험치'.length).trim();
      if (!args) {
        return message.reply('❌ 사용법: `!경험치 캐릭터닉네임`');
      }

      await this.handleExpCommand(message, args);
    });

    // 종료 시그널 처리
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  // 경험치 조회 명령어 처리
  async handleExpCommand(message, characterName) {
    try {
      const loadingMsg = await message.reply('🔍 경험치 정보를 조회 중...');

      // 1. OCID 조회
      const ocid = await this.nexonApi.getCharacterOcid(characterName);
      if (!ocid) {
        return loadingMsg.edit(`❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`);
      }

      // 2. 기본 정보 조회
      const basicInfo = await this.nexonApi.getCharacterBasic(ocid);

      // 3. 경험치 히스토리 조회 (최근 10일)
      const history = await this.nexonApi.getExpHistoryRange(ocid, 10);

      if (history.length < 2) {
        return loadingMsg.edit(`❌ "${characterName}"의 경험치 히스토리 데이터가 충분하지 않습니다.`);
      }

      // 4. 경험치 변화량 계산
      const changes = this.nexonApi.calculateExpChanges(history);

      // 5. 통계 계산
      const totalExpGain = changes.reduce((sum, c) => sum + c.expGain, 0);
      const avgExpGain = totalExpGain / changes.length;

      // 6. QuickChart.io로 그래프 생성 (경험치율 히스토리)
      const chartUrl = this.generateChartUrl(history);

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

      await loadingMsg.edit({ content: '', embeds: [embed] });
      logger.info(`경험치 조회 완료: ${characterName}`);

    } catch (error) {
      logger.error(`경험치 조회 실패 (${characterName}):`, error);

      let errorMessage = '❌ 경험치 조회 중 오류가 발생했습니다.';
      if (error.message.includes('400')) {
        errorMessage = `❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`;
      } else if (error.message.includes('429')) {
        errorMessage = '❌ API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
      }

      await message.reply(errorMessage);
    }
  }

  // QuickChart.io URL 생성 (바 그래프 - 경험치율 히스토리)
  generateChartUrl(history) {
    const labels = history.map(h => {
      if (h.date === 'NOW') return 'NOW';
      const date = new Date(h.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const data = history.map(h => parseFloat(h.expRate.toFixed(2)));

    const chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '경험치 (%)',
          data: data,
          backgroundColor: 'rgba(255, 153, 0, 0.8)',
          borderColor: 'rgb(255, 153, 0)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false
          },
          datalabels: {
            display: true,
            color: '#ffffff',
            anchor: 'end',
            align: 'top',
            font: {
              weight: 'bold',
              size: 11
            },
            formatter: (value) => value + '%'
          }
        },
        scales: {
          x: {
            ticks: { color: '#ffffff', font: { size: 11 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { color: '#ffffff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          }
        }
      }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}&backgroundColor=%23303030&width=800&height=400`;
  }

  // 사용법 안내 게시 (최초 1회만)
  async postUsageGuide() {
    // 환경변수로 이미 게시 여부 체크
    if (process.env.USAGE_GUIDE_POSTED === 'true') {
      return;
    }

    const channelId = process.env.CHANNEL_ID_EXP;
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('🍁 경험치 조회 사용법')
        .setDescription('메이플스토리 캐릭터의 최근 10일간 경험치 히스토리를 조회할 수 있습니다.')
        .addFields(
          { name: '📝 사용 방법', value: '```\n!경험치 캐릭터닉네임\n```', inline: false },
          { name: '📌 예시', value: '`!경험치 김막도`\n`!경험치 삼지창`\n`!경험치 제빙`\n`!경험치 방난`', inline: false },
          { name: '📊 제공 정보', value: '• 캐릭터 기본 정보 (월드, 레벨, 직업)\n• 10일간 경험치 획득량 그래프\n• 총 획득량 및 일평균 획득량\n• 길드 정보', inline: false }
        )
        .setFooter({ text: 'Nexon Open API 기반 • 데이터는 매일 새벽 갱신됩니다' })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      logger.info('경험치 조회 사용법 안내 게시 완료');

    } catch (error) {
      logger.error('사용법 안내 게시 실패:', error);
    }
  }

  // 주기적 업데이트 체크 시작
  startPeriodicCheck() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(async () => {
      await this.checkUpdates();
    }, this.checkInterval);

    logger.info(`주기적 체크 시작: ${this.checkInterval / 60000}분마다`);
  }

  // 업데이트 체크 및 알림
  async checkUpdates() {
    if (this.isRunning) {
      logger.warn('이미 체크 중입니다.');
      return;
    }

    this.isRunning = true;
    logger.info('=== 업데이트 체크 시작 ===');

    try {
      // 크롤링
      const notices = await this.crawler.crawlAll();

      if (notices.length === 0) {
        logger.info('새로운 공지사항 없음');
        return;
      }

      // 새로운 공지사항 필터링
      const newNotices = notices.filter(notice => !this.db.exists(notice.id));

      if (newNotices.length === 0) {
        logger.info('모든 공지사항이 이미 게시됨');
        return;
      }

      logger.info(`새로운 공지사항 ${newNotices.length}개 발견`);

      // 첫 실행 시에는 DB에만 저장하고 알림 안 보냄
      if (this.isFirstRun) {
        logger.info('첫 실행: 기존 공지사항을 DB에 저장만 합니다 (알림 안 보냄)');
        for (const notice of newNotices) {
          this.db.insert(notice);
        }
        logger.info(`=== ${newNotices.length}개 공지사항 DB 저장 완료 ===`);
        this.isFirstRun = false;
        return;
      }

      // 디스코드에 전송 (최신순으로 정렬해서 오래된 것부터 전송)
      const sortedNotices = newNotices.reverse();

      for (const notice of sortedNotices) {
        // 상세 내용 가져오기
        const rawContent = await this.crawler.fetchContent(notice.link);

        // AI 요약 (업데이트/이벤트인 경우)
        if ((notice.category === 'update' || notice.category === 'event') && rawContent) {
          notice.content = await this.summarizer.summarize(rawContent, notice.title);
        } else {
          // 요약하지 않는 경우 앞부분만 표시
          notice.content = rawContent.length > 300
            ? rawContent.substring(0, 300) + '...'
            : rawContent;
        }

        const success = await this.discord.sendNotice(notice);
        if (success) {
          this.db.insert(notice);
        }
        // 연속 전송 시 Rate Limit 방지를 위한 대기
        await this.sleep(1000);
      }

      logger.info(`=== 총 ${newNotices.length}개 공지사항 처리 완료 ===`);

    } catch (error) {
      logger.error('업데이트 체크 중 에러:', error);
      await this.discord.sendError(error);
    } finally {
      this.isRunning = false;
    }
  }

  // 데이터 정리 (매일 자정 실행)
  startDailyCleanup() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const timeUntilMidnight = tomorrow - now;

    setTimeout(() => {
      this.performCleanup();
      // 이후 24시간마다 실행
      setInterval(() => this.performCleanup(), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);

    logger.info(`일일 정리 작업 예약: ${tomorrow.toLocaleString('ko-KR')}`);
  }

  // 정리 작업 수행
  performCleanup() {
    logger.info('=== 데이터 정리 시작 ===');
    const deletedCount = this.db.cleanup();
    logger.info(`=== 데이터 정리 완료: ${deletedCount}개 삭제 ===`);
  }

  // 유틸: sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 종료 처리
  async shutdown() {
    logger.info('봇 종료 시작...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.db.close();
    await this.client.destroy();

    logger.info('봇 종료 완료');
    process.exit(0);
  }
}

// 봇 실행
const bot = new MapleBot();
bot.init().catch(error => {
  logger.error('봇 실행 실패:', error);
  process.exit(1);
});
