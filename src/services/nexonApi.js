const logger = require('../utils/logger');

class NexonApi {
  constructor() {
    this.apiKey = process.env.NEXON_API_KEY;
    this.baseUrl = 'https://open.api.nexon.com/maplestory/v1';
  }

  // API 요청 헬퍼
  async request(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    const response = await fetch(url.toString(), {
      headers: {
        'x-nxopen-api-key': this.apiKey
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Nexon API Error: ${response.status} - ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  // 캐릭터명으로 OCID 조회
  async getCharacterOcid(characterName) {
    try {
      const data = await this.request('/id', { character_name: characterName });
      return data.ocid;
    } catch (error) {
      logger.error(`OCID 조회 실패 (${characterName}):`, error);
      throw error;
    }
  }

  // 캐릭터 기본 정보 조회
  async getCharacterBasic(ocid, date = null) {
    try {
      const params = { ocid };
      if (date) {
        params.date = date;
      }
      return await this.request('/character/basic', params);
    } catch (error) {
      logger.error(`캐릭터 기본 정보 조회 실패:`, error);
      throw error;
    }
  }

  // 날짜 포맷 (YYYY-MM-DD)
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 최근 N일 경험치 히스토리 조회
  async getExpHistoryRange(ocid, days = 10) {
    const history = [];
    const today = new Date();

    // 오늘 데이터 (date 파라미터 생략 시 가장 최근 데이터 반환 - 오늘 새벽 갱신분)
    try {
      const todayData = await this.request('/character/basic', { ocid });
      history.push({
        date: 'NOW',
        level: todayData.character_level,
        exp: todayData.character_exp,
        expRate: parseFloat(todayData.character_exp_rate)
      });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      logger.warn('오늘 경험치 조회 실패:', error.message);
    }

    // 과거 N일 데이터
    for (let i = 1; i <= days; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() - i);
      const dateStr = this.formatDate(targetDate);

      try {
        const data = await this.request('/character/basic', { ocid, date: dateStr });

        history.push({
          date: dateStr,
          level: data.character_level,
          exp: data.character_exp,
          expRate: parseFloat(data.character_exp_rate)
        });
      } catch (error) {
        logger.warn(`${dateStr} 경험치 조회 실패:`, error.message);
        // 해당 날짜 데이터가 없으면 건너뜀
      }

      // Rate limit 방지
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 날짜 오름차순 정렬 (NOW는 맨 마지막)
    return history.sort((a, b) => {
      if (a.date === 'NOW') return 1;
      if (b.date === 'NOW') return -1;
      return new Date(a.date) - new Date(b.date);
    });
  }

  // 경험치 변화량 계산
  calculateExpChanges(history) {
    const changes = [];

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      // 경험치 변화량 (레벨업 고려)
      let expDiff = curr.expRate - prev.expRate;

      // 레벨업한 경우 (경험치율이 감소했다면)
      if (curr.level > prev.level) {
        // 레벨업 횟수만큼 100% 추가
        const levelUps = curr.level - prev.level;
        expDiff = (100 - prev.expRate) + curr.expRate + (levelUps - 1) * 100;
      }

      changes.push({
        date: curr.date,
        expGain: Math.max(0, expDiff), // 음수 방지
        level: curr.level,
        expRate: curr.expRate
      });
    }

    return changes;
  }
}

module.exports = NexonApi;
