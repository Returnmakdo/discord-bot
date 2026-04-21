require('dotenv').config();
const {
  Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const MapleCrawler = require('./services/crawler');
const DiscordService = require('./services/discord');
const Summarizer = require('./services/summarizer');
const NexonApi = require('./services/nexonApi');
const MusicService = require('./services/music');
const skillCalculator = require('./services/skillCalculator');
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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
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
    this.music = null;
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

      // 음악 서비스 초기화
      this.music = new MusicService(this.client);
      logger.info('음악 서비스 초기화 완료');

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

    // 메시지 명령어 처리
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!message.content.startsWith('!')) return;

      // 경험치 명령어
      if (message.content.startsWith('!경험치')) {
        const allowedChannel = process.env.CHANNEL_ID_EXP;
        if (allowedChannel && message.channelId !== allowedChannel) return;

        const args = message.content.slice('!경험치'.length).trim();
        if (!args) {
          return message.reply('❌ 사용법: `!경험치 캐릭터닉네임`');
        }
        return this.handleExpCommand(message, args);
      }

      // 6차 스킬 강화 계산기
      if (message.content.trim() === '!6차') {
        const allowedChannel = process.env.CHANNEL_ID_SKILL;
        if (allowedChannel && message.channelId !== allowedChannel) return;
        return this.handleSkillCommand(message);
      }

      // 음악 명령어
      if (this.music) {
        await this.handleMusicCommand(message);
      }
    });

    // 버튼/Modal 인터랙션 처리
    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isButton() && interaction.customId.startsWith('skill_core:')) {
          const coreId = interaction.customId.slice('skill_core:'.length);
          return this.showSkillModal(interaction, coreId);
        }
        if (interaction.isModalSubmit() && interaction.customId.startsWith('skill_modal:')) {
          const coreId = interaction.customId.slice('skill_modal:'.length);
          return this.handleSkillModalSubmit(interaction, coreId);
        }
      } catch (error) {
        logger.error('인터랙션 처리 에러:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    });

    // 종료 시그널 처리
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  // 경험치 조회 명령어 처리
  async handleExpCommand(message, characterName) {
    let loadingMsg = null;
    try {
      loadingMsg = await message.reply('🔍 경험치 정보를 조회 중...');

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

      // 5. 상세 히스토리 텍스트 생성
      const historyText = this.generateHistoryText(history, characterName, basicInfo.world_name);

      // 6. 통계 계산
      const totalExpGain = changes.reduce((sum, c) => sum + c.expGain, 0);
      const avgExpGain = changes.length > 0 ? totalExpGain / changes.length : 0;

      // 일평균 경험치
      const expChanges = [];
      for (let i = 1; i < history.length; i++) {
        const diff = history[i].exp - history[i-1].exp;
        if (diff > 0) expChanges.push(diff);
      }
      const avgExp = expChanges.length > 0
        ? expChanges.reduce((a, b) => a + b, 0) / expChanges.length
        : 0;

      // 남은 경험치 계산 (현재 레벨에서 100%까지)
      const currentExp = history[history.length - 1]?.exp || 0;
      const currentExpRate = history[history.length - 1]?.expRate || 0;
      const remainingExpRate = 100 - currentExpRate;
      const totalExpForLevel = currentExpRate > 0 ? (currentExp / currentExpRate) * 100 : 0;
      const remainingExp = totalExpForLevel - currentExp;

      // 예상 레벨업 날짜 계산
      let levelUpDateText = '계산 불가';
      if (avgExpGain > 0) {
        const daysToLevelUp = Math.ceil(remainingExpRate / avgExpGain);
        const levelUpDate = new Date();
        levelUpDate.setDate(levelUpDate.getDate() + daysToLevelUp);
        const year = String(levelUpDate.getFullYear()).slice(2);
        const month = String(levelUpDate.getMonth() + 1).padStart(2, '0');
        const day = String(levelUpDate.getDate()).padStart(2, '0');
        levelUpDateText = `${year}년 ${month}월 ${day}일 (${daysToLevelUp}일 후)`;
      }

      // 7. QuickChart.io로 그래프 생성 (경험치율 히스토리)
      const chartUrl = this.generateChartUrl(history);

      // 8. Embed 생성
      const embed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle('🍁 메이플스토리 경험치 히스토리')
        .setDescription(historyText)
        .addFields(
          { name: '📊 일일 평균 획득량', value: `${this.formatExpNumber(avgExp).replace('+', '')} (${avgExpGain.toFixed(2)}%)`, inline: true },
          { name: '📦 남은 경험치량', value: `${this.formatExpNumber(remainingExp).replace('+', '')} (${remainingExpRate.toFixed(2)}%)`, inline: true },
          { name: '📅 예상 레벨업 날짜', value: levelUpDateText, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Nexon Open API' });

      // 길드 정보가 있으면 추가
      if (basicInfo.character_guild_name) {
        embed.addFields({ name: '🎮 길드', value: basicInfo.character_guild_name, inline: true });
      }

      // 그래프 이미지 다운로드 후 Embed에 첨부
      const chartResponse = await fetch(chartUrl);
      const chartBuffer = Buffer.from(await chartResponse.arrayBuffer());
      const attachment = new AttachmentBuilder(chartBuffer, { name: 'exp_chart.png' });
      embed.setImage('attachment://exp_chart.png');

      await loadingMsg.edit({ content: '', embeds: [embed], files: [attachment] });
      logger.info(`경험치 조회 완료: ${characterName}`);

    } catch (error) {
      logger.error(`경험치 조회 실패 (${characterName}):`, error);

      let errorMessage = '❌ 경험치 조회 중 오류가 발생했습니다.';
      if (error.message.includes('400')) {
        errorMessage = `❌ 캐릭터 "${characterName}"을(를) 찾을 수 없습니다.`;
      } else if (error.message.includes('429')) {
        errorMessage = '❌ API 요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.';
      }

      if (loadingMsg) {
        await loadingMsg.edit(errorMessage);
      } else {
        await message.reply(errorMessage);
      }
    }
  }

  // 6차 스킬 강화 계산기 UI 전송
  async handleSkillCommand(message) {
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
        new ButtonBuilder().setCustomId('skill_core:skill').setLabel('스킬 코어').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skill_core:enhancement').setLabel('강화 코어').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skill_core:mastery').setLabel('마스터리 코어').setStyle(ButtonStyle.Primary)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('skill_core:common').setLabel('공용 코어').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skill_core:third_common').setLabel('3rd 공용 코어').setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row1, row2] });
    } catch (error) {
      logger.error('6차 계산기 UI 전송 실패:', error);
      await message.reply('❌ 계산기 UI를 불러오지 못했습니다.').catch(() => {});
    }
  }

  // 코어 버튼 → Modal 팝업
  async showSkillModal(interaction, coreId) {
    const label = skillCalculator.coreLabels[coreId];
    if (!label) {
      return interaction.reply({ content: '❌ 알 수 없는 코어 종류입니다.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId(`skill_modal:${coreId}`)
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

  // Modal 제출 → 결과 embed 응답
  async handleSkillModalSubmit(interaction, coreId) {
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

  // 음악 명령어 처리
  async handleMusicCommand(message) {
    const content = message.content;

    try {
      if (content.startsWith('!재생') || content.startsWith('!play') || content.startsWith('!p ')) {
        const query = content.replace(/^!(재생|play|p)\s*/, '').trim();
        if (!query) {
          return message.reply('❌ 사용법: `!재생 <검색어 또는 URL>`');
        }
        await this.music.play(message, query);
      } else if (content === '!스킵' || content === '!skip' || content === '!s') {
        await this.music.skip(message);
      } else if (content === '!정지' || content === '!stop') {
        await this.music.stop(message);
      } else if (content === '!일시정지' || content === '!pause') {
        await this.music.pause(message);
      } else if (content === '!재개' || content === '!resume') {
        await this.music.resume(message);
      } else if (content === '!큐' || content === '!queue' || content === '!q') {
        await this.music.queue(message);
      } else if (content === '!현재곡' || content === '!np' || content === '!nowplaying') {
        await this.music.nowPlaying(message);
      } else if (content.startsWith('!음량') || content.startsWith('!volume') || content.startsWith('!vol')) {
        const vol = content.replace(/^!(음량|volume|vol)\s*/, '').trim();
        if (!vol) {
          return message.reply('❌ 사용법: `!음량 <0-100>`');
        }
        await this.music.volume(message, vol);
      }
    } catch (error) {
      logger.error('음악 명령어 처리 에러:', error);
      await message.reply('❌ 음악 명령어 처리 중 오류가 발생했습니다.').catch(() => {});
    }
  }

  // 숫자를 한국식 단위로 변환 (억, 조, 경)
  formatExpNumber(num) {
    if (num === 0) return '0';

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '+';

    if (absNum >= 10000000000000000) { // 경 (10^16)
      return `${sign}${(absNum / 10000000000000000).toFixed(1)}경`;
    } else if (absNum >= 1000000000000) { // 조 (10^12)
      return `${sign}${(absNum / 1000000000000).toFixed(1)}조`;
    } else if (absNum >= 100000000) { // 억 (10^8)
      return `${sign}${(absNum / 100000000).toFixed(1)}억`;
    } else if (absNum >= 10000) { // 만 (10^4)
      return `${sign}${(absNum / 10000).toFixed(1)}만`;
    } else {
      return `${sign}${absNum.toFixed(0)}`;
    }
  }

  // 히스토리 텍스트 생성
  generateHistoryText(history, characterName, worldName) {
    let text = `**${characterName}** - ${worldName}\n\`\`\`\n`;

    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      let dateStr;

      if (h.date === 'NOW') {
        dateStr = 'NOW      ';
      } else {
        const date = new Date(h.date);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        dateStr = `${month}월 ${day}일`;
      }

      let expGainText = '';
      if (i > 0) {
        const expDiff = history[i].exp - history[i-1].exp;
        if (expDiff > 0) {
          expGainText = ` (${this.formatExpNumber(expDiff)})`;
        } else {
          expGainText = ` (+0)`;
        }
      }

      text += `${dateStr} : Lv.${h.level} ${h.expRate.toFixed(3)}%${expGainText}\n`;
    }

    text += `\`\`\``;
    return text;
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
          backgroundColor: 'rgba(242, 250, 0, 0.9)',
          borderColor: 'rgb(242, 250, 0)',
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
              size: 14
            },
            formatter: (value) => value + '%'
          }
        },
        scales: {
          x: {
            ticks: { color: '#ffffff', font: { size: 14 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            min: 0,
            max: 100,
            ticks: {
              color: '#ffffff',
              font: { size: 12 },
              stepSize: 10
            },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          }
        }
      }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}&backgroundColor=%23303030&width=1600&height=900&version=3`;
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

        // 이벤트인 경우 상세 페이지에서 대표 이미지 가져오기
        if (notice.category === 'event') {
          const eventImage = await this.crawler.fetchEventImage(notice.link);
          if (eventImage) {
            notice.image = eventImage;
          }
        }

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
