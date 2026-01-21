const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class MapleCrawler {
  constructor() {
    this.baseUrl = 'https://maplestory.nexon.com';
    this.noticeUrl = `${this.baseUrl}/News/Notice`;
    this.updateUrl = `${this.baseUrl}/News/Update`;
    this.retryCount = 3;
    this.retryDelay = 5000;
  }

  // 카테고리 판별
  categorizeNotice(title) {
    const titleLower = title.toLowerCase();
    
    if (titleLower.includes('점검') || titleLower.includes('작업')) {
      return 'maintenance';
    }
    if (titleLower.includes('업데이트') || titleLower.includes('패치')) {
      return 'update';
    }
    if (titleLower.includes('이벤트') || titleLower.includes('출석')) {
      return 'event';
    }
    
    return 'notice';
  }

  // 상세 페이지에서 내용 가져오기
  async fetchContent(url) {
    try {
      const response = await this.fetchWithRetry(url);
      const $ = cheerio.load(response.data);

      // 공지사항 본문 내용 추출
      let content = '';
      const $content = $('.new_board_con');

      if ($content.length) {
        // br 태그를 줄바꿈으로 변환
        $content.find('br').replaceWith('\n');
        // p, div 태그 뒤에 줄바꿈 추가
        $content.find('p, div').each((i, el) => {
          $(el).append('\n');
        });
        // 리스트 항목에 bullet point 추가
        $content.find('li').each((i, el) => {
          $(el).prepend('• ');
          $(el).append('\n');
        });

        // 텍스트 추출
        content = $content.text().trim();
        // 3개 이상 연속 줄바꿈을 2개로 정리
        content = content.replace(/\n{3,}/g, '\n\n');
        // 각 줄의 앞뒤 공백 제거
        content = content.split('\n').map(line => line.trim()).filter(line => line).join('\n');
      }

      return content;
    } catch (error) {
      logger.warn(`상세 내용 크롤링 실패: ${url}`);
      return '';
    }
  }

  // 재시도 로직이 포함된 HTTP 요청
  async fetchWithRetry(url, attempt = 1) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      return response;
    } catch (error) {
      if (attempt < this.retryCount) {
        logger.warn(`크롤링 실패 (시도 ${attempt}/${this.retryCount}), ${this.retryDelay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw error;
    }
  }

  // 공지사항 크롤링
  async crawlNotices() {
    try {
      logger.debug('공지사항 크롤링 시작...');
      const response = await this.fetchWithRetry(this.noticeUrl);
      const $ = cheerio.load(response.data);
      const notices = [];

      // 최근 5개만 가져오기
      $('.news_board ul li').slice(0, 5).each((index, element) => {
        const $elem = $(element);
        const $link = $elem.find('p a');
        const href = $link.attr('href');

        if (!href) return;

        const title = $link.find('span').text().trim();
        const notice = {
          id: href.split('/').pop(),
          title: title,
          link: `${this.baseUrl}${href}`,
          date: $elem.find('.heart_date dd').text().trim(),
          category: this.categorizeNotice(title)
        };

        notices.push(notice);
      });

      logger.info(`공지사항 ${notices.length}개 수집 완료`);
      return notices;
    } catch (error) {
      logger.error('공지사항 크롤링 실패:', error.message);
      return [];
    }
  }

  // 업데이트 크롤링
  async crawlUpdates() {
    try {
      logger.debug('업데이트 크롤링 시작...');
      const response = await this.fetchWithRetry(this.updateUrl);
      const $ = cheerio.load(response.data);
      const updates = [];

      $('.update_board ul li').slice(0, 3).each((index, element) => {
        const $elem = $(element);
        const $link = $elem.find('p a');
        const href = $link.attr('href');

        if (!href) return;

        const title = $link.find('span').text().trim();
        const update = {
          id: `update_${href.split('/').pop()}`,
          title: title,
          link: `${this.baseUrl}${href}`,
          date: $elem.find('.heart_date dd').text().trim(),
          category: 'update'
        };

        updates.push(update);
      });

      logger.info(`업데이트 ${updates.length}개 수집 완료`);
      return updates;
    } catch (error) {
      logger.error('업데이트 크롤링 실패:', error.message);
      return [];
    }
  }

  // 전체 크롤링
  async crawlAll() {
    const [notices, updates] = await Promise.all([
      this.crawlNotices(),
      this.crawlUpdates()
    ]);

    return [...notices, ...updates];
  }
}

module.exports = MapleCrawler;
