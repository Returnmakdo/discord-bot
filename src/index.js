require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const MapleCrawler = require('./services/crawler');
const DiscordService = require('./services/discord');
const Summarizer = require('./services/summarizer');
const NoticeDB = require('./utils/database');
const logger = require('./utils/logger');
const fs = require('fs');
const path = require('path');

// 명령어 파일 로드
const characterCommand = require('./commands/character');

class MapleBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
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

    // 슬래시 명령어 컬렉션
    this.commands = new Collection();
    this.commands.set(characterCommand.data.name, characterCommand);
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

      // 슬래시 명령어 등록
      await this.registerCommands();

      // 이벤트 핸들러 등록
      this.setupEventHandlers();

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

  // 슬래시 명령어 등록 (길드 전용 - 즉시 반영)
  async registerCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
      const commands = this.commands.map(cmd => cmd.data.toJSON());
      const guildId = process.env.GUILD_ID || '1463510406101209211';

      logger.info(`슬래시 명령어 ${commands.length}개 등록 중... (서버: ${guildId})`);

      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, guildId),
        { body: commands }
      );

      logger.info('슬래시 명령어 등록 완료');
    } catch (error) {
      logger.error('슬래시 명령어 등록 실패:', error);
    }
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

    // 슬래시 명령어 처리
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error(`명령어 실행 오류 (${interaction.commandName}):`, error);

        const errorMessage = { content: '❌ 명령어 실행 중 오류가 발생했습니다.', ephemeral: true };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    });

    // 종료 시그널 처리
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
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
