const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class NoticeDB {
  constructor() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'notices.db');
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS notices (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `;

    try {
      this.db.exec(createTable);
      logger.info('데이터베이스 초기화 완료');
    } catch (error) {
      logger.error('데이터베이스 초기화 실패:', error);
      throw error;
    }
  }

  // 공지사항 존재 여부 확인
  exists(noticeId) {
    const stmt = this.db.prepare('SELECT id FROM notices WHERE id = ?');
    return stmt.get(noticeId) !== undefined;
  }

  // 새 공지사항 저장
  insert(notice) {
    const stmt = this.db.prepare(`
      INSERT INTO notices (id, title, link, date, category, posted_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        notice.id,
        notice.title,
        notice.link,
        notice.date,
        notice.category,
        Date.now()
      );
      logger.info(`공지사항 저장: ${notice.title}`);
      return true;
    } catch (error) {
      logger.error('공지사항 저장 실패:', error);
      return false;
    }
  }

  // 최근 공지사항 조회
  getRecent(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM notices 
      ORDER BY posted_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  // 카테고리별 조회
  getByCategory(category, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM notices 
      WHERE category = ?
      ORDER BY posted_at DESC 
      LIMIT ?
    `);
    return stmt.all(category, limit);
  }

  // 오래된 데이터 정리 (30일 이상)
  cleanup() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare('DELETE FROM notices WHERE posted_at < ?');
    
    try {
      const result = stmt.run(thirtyDaysAgo);
      logger.info(`오래된 공지사항 ${result.changes}개 삭제`);
      return result.changes;
    } catch (error) {
      logger.error('데이터 정리 실패:', error);
      return 0;
    }
  }

  close() {
    this.db.close();
    logger.info('데이터베이스 연결 종료');
  }
}

module.exports = NoticeDB;
