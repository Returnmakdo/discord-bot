const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

class Summarizer {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    this.enabled = !!process.env.ANTHROPIC_API_KEY;

    if (!this.enabled) {
      logger.warn('ANTHROPIC_API_KEY가 설정되지 않음. AI 요약 기능 비활성화');
    }
  }

  // 패치 내용 요약
  async summarize(content, title) {
    if (!this.enabled || !content || content.length < 50) {
      return this.fallbackSummary(content);
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `다음은 메이플스토리 "${title}" 패치 노트입니다.
핵심 내용만 간결하게 요약해주세요.

규칙:
- 3~5개의 핵심 항목으로 요약
- 각 항목은 한 줄로 간결하게
- 이모지를 적절히 사용 (🔧 수정, ✨ 신규, 🎁 이벤트, ⚔️ 보스, 🛡️ 직업)
- 전문 용어는 그대로 사용
- 총 200자 이내로 작성

패치 내용:
${content.substring(0, 2000)}`
          }
        ]
      });

      const summary = response.content[0].text.trim();
      logger.debug(`AI 요약 완료: ${title}`);
      return summary;
    } catch (error) {
      logger.error(`AI 요약 실패: ${error.message}`);
      return this.fallbackSummary(content);
    }
  }

  // AI 실패시 폴백 요약 (앞부분만 추출)
  fallbackSummary(content) {
    if (!content) return '';

    // 줄바꿈 기준으로 앞 5줄만 추출
    const lines = content.split('\n').filter(line => line.trim());
    const preview = lines.slice(0, 5).join('\n');

    if (preview.length > 300) {
      return preview.substring(0, 300) + '...';
    }
    return preview;
  }
}

module.exports = Summarizer;
