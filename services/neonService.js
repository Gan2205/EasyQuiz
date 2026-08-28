/**
 * Neon Serverless PostgreSQL Database Service
 * Provides ultra-fast, 100% persistent relational database storage for EasyQuiz.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_BUILDER);
const STORE_PATH = IS_VERCEL ? path.join('/tmp', 'store.json') : path.join(__dirname, '..', 'data', 'store.json');

const NEON_DATABASE_URL = process.env.DATABASE_URL || 
  process.env.NEON_DATABASE_URL || 
  'postgresql://neondb_owner:npg_oD3bSeg5OMJF@ep-withered-waterfall-aws9pvnl-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require';

const sql = neon(NEON_DATABASE_URL);

const NeonService = {
  getConnectionString: () => NEON_DATABASE_URL,

  getStatus: () => ({
    connected: true,
    engine: 'Neon Serverless PostgreSQL',
    database: 'neondb'
  }),

  // Read entire store baseline from Neon PostgreSQL
  pullFromNeon: async () => {
    try {
      const storeData = {
        admin: { username: 'SCRS', password: 'SCRS@2026' },
        quizzes: [],
        students: [],
        sessions: {},
        results: []
      };

      // 1. Quizzes
      const quizRows = await sql`SELECT id, title, description, time_limit_minutes AS "timeLimitMinutes", questions FROM quizzes ORDER BY created_at ASC`;
      storeData.quizzes = (quizRows || []).map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        timeLimitMinutes: r.timeLimitMinutes,
        questions: typeof r.questions === 'string' ? JSON.parse(r.questions) : (r.questions || [])
      }));

      // 2. Students
      const studentRows = await sql`SELECT id, name, roll_number AS "rollNumber", username, password, created_at AS "createdAt" FROM students ORDER BY created_at ASC`;
      storeData.students = (studentRows || []).map(r => ({
        id: r.id,
        name: r.name,
        rollNumber: r.rollNumber,
        username: r.username,
        password: r.password,
        createdAt: r.createdAt
      }));

      // 3. Sessions
      const sessionRows = await sql`SELECT session_key AS "sessionKey", username, student_name AS "studentName", roll_number AS "rollNumber", quiz_id AS "quizId", quiz_title AS "quizTitle", start_time AS "startTime", time_limit_minutes AS "timeLimitMinutes", status, tab_switch_count AS "tabSwitchCount", violations, answers, jumbled_questions AS "jumbledQuestions", unblocked_at AS "unblockedAt", blocked_at AS "blockedAt", blocked_reason AS "blockedReason" FROM sessions`;
      (sessionRows || []).forEach(r => {
        storeData.sessions[r.sessionKey] = {
          sessionKey: r.sessionKey,
          username: r.username,
          studentName: r.studentName,
          rollNumber: r.rollNumber,
          quizId: r.quizId,
          quizTitle: r.quizTitle,
          startTime: Number(r.startTime),
          timeLimitMinutes: r.timeLimitMinutes,
          status: r.status,
          tabSwitchCount: r.tabSwitchCount || 0,
          violations: typeof r.violations === 'string' ? JSON.parse(r.violations) : (r.violations || []),
          answers: typeof r.answers === 'string' ? JSON.parse(r.answers) : (r.answers || {}),
          jumbledQuestions: typeof r.jumbled_questions === 'string' ? JSON.parse(r.jumbled_questions) : (r.jumbledQuestions || []),
          unblockedAt: r.unblockedAt,
          blockedAt: r.blockedAt,
          blockedReason: r.blockedReason
        };
      });

      // 4. Results
      const resultRows = await sql`SELECT id, session_key AS "sessionKey", username, student_name AS "studentName", roll_number AS "rollNumber", quiz_id AS "quizId", quiz_title AS "quizTitle", score, total_questions AS "totalQuestions", percentage, time_spent_seconds AS "timeSpentSeconds", tab_switch_count AS "tabSwitchCount", violations_count AS "violationsCount", violations, status, submitted_at AS "submittedAt" FROM results ORDER BY submitted_at DESC`;
      storeData.results = (resultRows || []).map(r => ({
        id: r.id,
        sessionKey: r.sessionKey,
        username: r.username,
        studentName: r.studentName,
        rollNumber: r.rollNumber,
        quizId: r.quizId,
        quizTitle: r.quizTitle,
        score: r.score,
        totalQuestions: r.totalQuestions,
        percentage: r.percentage,
        timeSpentSeconds: r.timeSpentSeconds,
        tabSwitchCount: r.tabSwitchCount,
        violationsCount: r.violationsCount,
        violations: typeof r.violations === 'string' ? JSON.parse(r.violations) : (r.violations || []),
        status: r.status,
        submittedAt: r.submittedAt
      }));

      try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(storeData, null, 2), 'utf8');
      } catch (e) {}

      return { success: true, data: storeData };
    } catch (err) {
      console.warn('Neon Database Pull Notice:', err.message);
      return { success: false, error: err.message };
    }
  },

  // Sync complete store data to Neon PostgreSQL
  syncToNeon: async (storeData) => {
    try {
      // 1. Upsert Quizzes
      if (Array.isArray(storeData.quizzes)) {
        for (const q of storeData.quizzes) {
          const questionsJson = JSON.stringify(q.questions || []);
          await sql`
            INSERT INTO quizzes (id, title, description, time_limit_minutes, questions)
            VALUES (${q.id}, ${q.title}, ${q.description}, ${q.timeLimitMinutes || 15}, ${questionsJson}::jsonb)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              time_limit_minutes = EXCLUDED.time_limit_minutes,
              questions = EXCLUDED.questions;
          `;
        }
      }

      // 2. Upsert Students
      if (Array.isArray(storeData.students)) {
        for (const s of storeData.students) {
          await sql`
            INSERT INTO students (id, name, roll_number, username, password)
            VALUES (${s.id}, ${s.name}, ${s.rollNumber}, ${s.username}, ${s.password})
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              roll_number = EXCLUDED.roll_number,
              username = EXCLUDED.username,
              password = EXCLUDED.password;
          `;
        }
      }

      // 3. Upsert Sessions
      if (storeData.sessions && typeof storeData.sessions === 'object') {
        for (const [sKey, sess] of Object.entries(storeData.sessions)) {
          const violationsJson = JSON.stringify(sess.violations || []);
          const answersJson = JSON.stringify(sess.answers || {});
          const jumbledJson = JSON.stringify(sess.jumbledQuestions || []);
          await sql`
            INSERT INTO sessions (
              session_key, username, student_name, roll_number, quiz_id, quiz_title,
              start_time, time_limit_minutes, status, tab_switch_count, violations,
              answers, jumbled_questions, unblocked_at, blocked_at, blocked_reason
            ) VALUES (
              ${sKey}, ${sess.username}, ${sess.studentName}, ${sess.rollNumber}, ${sess.quizId}, ${sess.quizTitle},
              ${sess.startTime || Date.now()}, ${sess.timeLimitMinutes || 15}, ${sess.status || 'IN_PROGRESS'}, ${sess.tabSwitchCount || 0}, ${violationsJson}::jsonb,
              ${answersJson}::jsonb, ${jumbledJson}::jsonb, ${sess.unblockedAt || null}, ${sess.blockedAt || null}, ${sess.blockedReason || null}
            ) ON CONFLICT (session_key) DO UPDATE SET
              status = EXCLUDED.status,
              tab_switch_count = EXCLUDED.tab_switch_count,
              violations = EXCLUDED.violations,
              answers = EXCLUDED.answers,
              unblocked_at = EXCLUDED.unblocked_at,
              blocked_at = EXCLUDED.blocked_at,
              blocked_reason = EXCLUDED.blocked_reason,
              updated_at = CURRENT_TIMESTAMP;
          `;
        }
      }

      // 4. Upsert Results
      if (Array.isArray(storeData.results)) {
        for (const r of storeData.results) {
          const violationsJson = JSON.stringify(r.violations || []);
          await sql`
            INSERT INTO results (
              id, session_key, username, student_name, roll_number, quiz_id, quiz_title,
              score, total_questions, percentage, time_spent_seconds, tab_switch_count,
              violations_count, violations, status
            ) VALUES (
              ${r.id}, ${r.sessionKey}, ${r.username}, ${r.studentName}, ${r.rollNumber}, ${r.quizId}, ${r.quizTitle},
              ${r.score || 0}, ${r.totalQuestions || 0}, ${r.percentage || 0}, ${r.timeSpentSeconds || 0}, ${r.tabSwitchCount || 0},
              ${r.violationsCount || 0}, ${violationsJson}::jsonb, ${r.status || 'PASSED'}
            ) ON CONFLICT (id) DO UPDATE SET
              score = EXCLUDED.score,
              percentage = EXCLUDED.percentage,
              status = EXCLUDED.status;
          `;
        }
      }

      return { success: true };
    } catch (err) {
      console.warn('Neon Database Sync Notice:', err.message);
      return { success: false, error: err.message };
    }
  },

  // Delete document
  deleteItem: async (table, id) => {
    try {
      if (table === 'quizzes') await sql`DELETE FROM quizzes WHERE id = ${id}`;
      else if (table === 'students') await sql`DELETE FROM students WHERE id = ${id}`;
      else if (table === 'results') await sql`DELETE FROM results WHERE id = ${id}`;
      else if (table === 'sessions') await sql`DELETE FROM sessions WHERE session_key = ${id}`;
      return { success: true };
    } catch (err) {
      console.warn(`Neon Delete Error (${table}/${id}):`, err.message);
      return { success: false };
    }
  },

  // Clear entire table
  clearTable: async (table) => {
    try {
      if (table === 'quizzes') await sql`TRUNCATE TABLE quizzes`;
      else if (table === 'students') await sql`TRUNCATE TABLE students`;
      else if (table === 'results') await sql`TRUNCATE TABLE results`;
      else if (table === 'sessions') await sql`TRUNCATE TABLE sessions`;
      return { success: true };
    } catch (err) {
      console.warn(`Neon Clear Error (${table}):`, err.message);
      return { success: false };
    }
  }
};

module.exports = NeonService;
