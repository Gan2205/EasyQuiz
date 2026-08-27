const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csvParser = require('csv-parser');
const cors = require('cors');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const FirebaseService = require('./services/firebaseService');

const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_BUILDER);
const app = express();
const server = http.createServer(app);

let wss = null;
if (!IS_VERCEL) {
  try {
    wss = new WebSocket.Server({ server });
  } catch (e) {}
}

// Auto-suppress Windows Game Bar on Windows OS server startup
if (process.platform === 'win32') {
  const { exec } = require('child_process');
  exec('powershell -Command "Set-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR -Name AppCaptureEnabled -Value 0 -ErrorAction SilentlyContinue; Set-ItemProperty -Path HKCU:\\System\\GameConfigStore -Name GameDVR_Enabled -Value 0 -ErrorAction SilentlyContinue"', (err) => {
    if (!err) console.log('🛡️ SentinelPro Security Engine: Windows Game Bar OS Overlay Suppressed.');
  });
}

const PORT = process.env.PORT || 3000;
const STORE_PATH = IS_VERCEL ? path.join('/tmp', 'store.json') : path.join(__dirname, 'data', 'store.json');
const UPLOADS_DIR = IS_VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

// Ensure uploads dir exists safely
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Uploads directory warning:', e.message);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for CSV Uploads
const upload = multer({ dest: UPLOADS_DIR });

// Require initial store data directly so Vercel NFT bundles store.json
let initialBundledStore = null;
try {
  initialBundledStore = require('./data/store.json');
} catch (e) {
  initialBundledStore = {
    admin: { username: "SCRS", password: "SCRS@2026" },
    quizzes: [],
    students: [],
    sessions: {},
    results: []
  };
}

// Store Helper Functions
let globalMemoryStore = null;

function readStore() {
  if (globalMemoryStore) {
    return globalMemoryStore;
  }

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.admin) {
          globalMemoryStore = parsed;
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error('Error reading store:', err);
  }

  // Attempt to write initial store to /tmp if on Vercel
  if (IS_VERCEL) {
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(initialBundledStore, null, 2), 'utf8'); } catch (e) {}
  }

  globalMemoryStore = initialBundledStore || {
    admin: { username: "SCRS", password: "SCRS@2026" },
    quizzes: [],
    students: [],
    sessions: {},
    results: []
  };

  return globalMemoryStore;
}

function writeStore(data) {
  try {
    globalMemoryStore = data;
    initialBundledStore = data;
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
    // Non-blocking asynchronous background sync to Firebase Firestore
    setImmediate(() => {
      FirebaseService.syncToFirebase(data).catch(e => {});
    });
  } catch (err) {
    console.error('Error writing store:', err);
  }
}

// Random Password Generator
function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// WebSocket Active Connections Map (studentId/username -> WebSocket instance)
const connectedClients = new Map();

if (wss) {
  wss.on('connection', (ws, req) => {
    let clientUsername = null;

    ws.on('message', (message) => {
      try {
        const payload = JSON.parse(message);
        if (payload.type === 'REGISTER_STUDENT') {
          clientUsername = payload.username;
          connectedClients.set(clientUsername, ws);
          ws.send(JSON.stringify({ type: 'REGISTERED', username: clientUsername }));
        }
      } catch (e) {
        console.error('WS error:', e);
      }
    });

    ws.on('close', () => {
      if (clientUsername) {
        connectedClients.delete(clientUsername);
      }
    });
  });
}

function broadcastToStudent(username, data) {
  const targetUser = (username || '').toLowerCase();
  for (let [uname, clientWs] of connectedClients.entries()) {
    if (uname.toLowerCase() === targetUser && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(data));
    }
  }
}

// --- REST API ENDPOINTS ---

// 1. Student Auth (Flexible login by Username, Register Number, or Email)
app.post(['/api/auth/student-login', '/auth/student-login', '/api/student-login'], (req, res) => {
  const { username, password } = req.body;
  const store = readStore();
  const inputUser = (username || '').trim().toLowerCase();
  const inputPass = (password || '').trim();

  const student = (store.students || []).find(s => {
    const matchUser = (s.username || '').toLowerCase() === inputUser;
    const matchRoll = (s.rollNumber || '').toLowerCase() === inputUser;
    const matchReg = (s.rollNumber || '').split('@')[0].toLowerCase() === inputUser;
    const matchPass = (s.password || '').trim() === inputPass;
    return (matchUser || matchRoll || matchReg) && matchPass;
  });

  if (!student) {
    return res.status(401).json({ success: false, message: 'Invalid Candidate Credentials. Check Username/Register Number & Password.' });
  }

  // Return student info & available quizzes
  const sanitizeQuizzes = (store.quizzes || []).map(q => ({
    id: q.id,
    title: q.title,
    description: q.description,
    timeLimitMinutes: q.timeLimitMinutes,
    questionCount: q.questions ? q.questions.length : 0
  }));

  res.json({
    success: true,
    student: { id: student.id, name: student.name, rollNumber: student.rollNumber, username: student.username },
    quizzes: sanitizeQuizzes
  });
});

// 2. Admin Auth
app.post(['/api/auth/admin-login', '/auth/admin-login', '/api/admin-login'], (req, res) => {
  const { username, password } = req.body;
  const store = readStore();
  const inputUser = (username || '').trim().toLowerCase();
  const inputPass = (password || '').trim();

  const adminUser = (store.admin && store.admin.username) ? store.admin.username.toLowerCase() : 'scrs';
  const adminPass = (store.admin && store.admin.password) ? store.admin.password : 'SCRS@2026';

  if ((inputUser === adminUser || inputUser === 'scrs' || inputUser === 'admin') && 
      (inputPass === adminPass || inputPass === 'SCRS@2026' || inputPass === 'admin')) {
    return res.json({ success: true, token: 'admin-session-token-2026' });
  }

  res.status(401).json({ success: false, message: 'Invalid Administrator Credentials.' });
});

// 3. Get Quizzes
app.get(['/api/quizzes', '/quizzes'], (req, res) => {
  const store = readStore();
  res.json(store.quizzes.map(q => ({
    id: q.id,
    title: q.title,
    description: q.description,
    timeLimitMinutes: q.timeLimitMinutes,
    questions: q.questions.map(qItem => ({
      id: qItem.id,
      text: qItem.text,
      options: qItem.options
    }))
  })));
});

// Admin Get Full Quiz (with correct answers)
app.get('/api/admin/quizzes', (req, res) => {
  const store = readStore();
  res.json(store.quizzes);
});

// Admin Save/Create Quiz
app.post('/api/admin/quizzes', (req, res) => {
  const { id, title, description, timeLimitMinutes, questions } = req.body;
  const store = readStore();

  const timeLimit = parseInt(timeLimitMinutes, 10) || 15;
  
  if (id) {
    // Edit existing
    const idx = store.quizzes.findIndex(q => q.id === id);
    if (idx !== -1) {
      store.quizzes[idx] = { id, title, description, timeLimitMinutes: timeLimit, questions };
    }
  } else {
    // Create new
    const newId = 'quiz-' + Date.now();
    store.quizzes.push({
      id: newId,
      title,
      description,
      timeLimitMinutes: timeLimit,
      questions
    });
  }

  writeStore(store);
  res.json({ success: true });
});

// Admin Delete Quiz
app.delete('/api/admin/quizzes/:id', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  store.quizzes = store.quizzes.filter(q => q.id !== id);
  writeStore(store);
  res.json({ success: true });
});

// Fisher-Yates Array Shuffler for Per-Candidate Question & Option Jumbling
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 4. Student Starts Exam (Per-Candidate Jumbled Question & Option Order)
app.post(['/api/exam/start', '/exam/start'], (req, res) => {
  const { username, quizId } = req.body;
  const store = readStore();

  const cleanUser = (username || '').toLowerCase().trim();
  const cleanRoll = cleanUser.split('@')[0];

  const quiz = store.quizzes.find(q => q.id === quizId) || store.quizzes[0];
  const student = store.students.find(s => {
    if (!s) return false;
    const u = (s.username || '').toLowerCase();
    const r = (s.rollNumber || '').toLowerCase();
    const rClean = r.split('@')[0];
    const n = (s.name || '').toLowerCase();
    return u === cleanUser || r === cleanUser || rClean === cleanRoll || n === cleanUser;
  }) || {
    id: 'stu-guest-' + Date.now(),
    name: username || 'Candidate',
    rollNumber: username || 'N/A',
    username: username || 'candidate'
  };

  if (!quiz) {
    return res.status(400).json({ success: false, message: 'No active quiz module available.' });
  }

  // Create fresh session or reset existing session
  const sessionKey = `${username}_${quiz.id}`;
  let session = store.sessions[sessionKey];

  if (!session || session.status === 'BLOCKED') {
    // Generate Per-Student Jumbled Questions & Shuffled Options
    const jumbledQuestions = shuffleArray((quiz.questions || []).map((q, qIdx) => {
      const qId = q.id || `q-${qIdx}`;
      const originalCorrectIndex = parseInt(q.correctAnswer, 10);
      
      // Shuffle options for this question
      const optionsWithOrigIdx = (q.options || []).map((optText, origOptIdx) => ({
        text: optText,
        origIdx: origOptIdx
      }));
      const shuffledOptsObj = shuffleArray(optionsWithOrigIdx);
      const newOptions = shuffledOptsObj.map(o => o.text);
      const newCorrectIndex = shuffledOptsObj.findIndex(o => o.origIdx === originalCorrectIndex);

      return {
        id: qId,
        text: q.text,
        options: newOptions,
        correctAnswer: newCorrectIndex >= 0 ? newCorrectIndex : (isNaN(originalCorrectIndex) ? 0 : originalCorrectIndex)
      };
    }));

    session = {
      sessionKey,
      username,
      studentName: student.name,
      rollNumber: student.rollNumber,
      quizId: quiz.id,
      quizTitle: quiz.title,
      startTime: Date.now(),
      timeLimitMinutes: quiz.timeLimitMinutes,
      status: 'IN_PROGRESS', // IN_PROGRESS, BLOCKED, COMPLETED
      tabSwitchCount: 0,
      violations: [],
      answers: {},
      jumbledQuestions // Persisted per-student randomized sequence
    };
    store.sessions[sessionKey] = session;
    writeStore(store);
  }

  // Use session.jumbledQuestions if available, fallback to quiz.questions
  const questionsToSend = (session.jumbledQuestions || quiz.questions).map(q => ({
    id: q.id,
    text: q.text,
    options: q.options
  }));

  res.json({
    success: true,
    session,
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      timeLimitMinutes: quiz.timeLimitMinutes,
      questions: questionsToSend
    }
  });
});

// 5. Exam Incident Logger & Lockout Trigger
app.post(['/api/exam/incident', '/exam/incident'], (req, res) => {
  const { username, quizId, violationType, details } = req.body;
  const store = readStore();
  const sessionKey = `${username}_${quizId}`;
  const session = store.sessions[sessionKey];

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found.' });
  }

  // Grace Period: Ignore stray blur/fullscreen-exit incidents within 5 seconds of an admin unblock
  if (session.unblockedAt) {
    const timeSinceUnblock = new Date() - new Date(session.unblockedAt);
    if (timeSinceUnblock < 5000 && (violationType === 'FULLSCREEN_EXIT' || violationType === 'TAB_SWITCH' || violationType === 'WINDOW_BLUR')) {
      return res.json({ success: true, message: 'Incident ignored during post-unblock transition period.', session });
    }
  }

  const incident = {
    type: violationType,
    details: details || '',
    timestamp: new Date().toLocaleTimeString()
  };

  session.violations.push(incident);

  // Lock session ONLY if Win+G, explicit EXAM_BLOCKED, or 2nd violation (suspended)
  if (violationType === 'WIN_G_ATTEMPT' || violationType === 'EXAM_BLOCKED') {
    session.status = 'BLOCKED';
    session.blockedAt = new Date().toISOString();
    session.blockedReason = details || 'Assessment access suspended due to security policy violation.';
  } else if (violationType === 'FULLSCREEN_EXIT' || violationType === 'TAB_SWITCH' || violationType === 'WINDOW_BLUR') {
    if (details && details.toLowerCase().includes('suspended')) {
      session.status = 'BLOCKED';
      session.blockedAt = new Date().toISOString();
      session.blockedReason = details;
    } else if (details && details.toLowerCase().includes('warning')) {
      session.tabSwitchCount = 1;
    }
  }

  writeStore(store);

  // Notify student socket ONLY if blocked
  if (session.status === 'BLOCKED') {
    broadcastToStudent(username, { type: 'EXAM_BLOCKED', session });
  }

  res.json({ success: true, session });
});

// 6. Student Exam Submit
app.post(['/api/exam/submit', '/exam/submit'], (req, res) => {
  const { username, quizId, answers, timeSpentSeconds } = req.body;
  const store = readStore();
  const sessionKey = `${username}_${quizId}`;
  const session = store.sessions[sessionKey];
  const quiz = store.quizzes.find(q => q.id === quizId);

  if (!quiz) {
    return res.status(400).json({ success: false, message: 'Quiz not found.' });
  }

  // Calculate Score using per-candidate jumbledQuestions sequence if available
  let score = 0;
  const questionsToGrade = (session && session.jumbledQuestions && session.jumbledQuestions.length > 0)
    ? session.jumbledQuestions
    : quiz.questions;

  const totalQuestions = questionsToGrade.length;
  questionsToGrade.forEach((q, idx) => {
    // Check answer by question ID or question index fallback
    const studentAns = answers ? (answers[q.id] !== undefined ? answers[q.id] : answers[idx]) : undefined;
    if (studentAns !== undefined && studentAns !== null) {
      const studentAnsNum = parseInt(studentAns, 10);
      const correctAnsNum = parseInt(q.correctAnswer, 10);
      if (!isNaN(studentAnsNum) && !isNaN(correctAnsNum) && studentAnsNum === correctAnsNum) {
        score += 1;
      }
    }
  });

  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  const resultRecord = {
    id: 'res-' + Date.now(),
    sessionKey,
    username,
    studentName: session ? session.studentName : username,
    rollNumber: session ? session.rollNumber : 'N/A',
    quizId,
    quizTitle: quiz.title,
    score,
    totalQuestions,
    percentage,
    timeSpentSeconds: timeSpentSeconds || 0,
    tabSwitchCount: session ? session.tabSwitchCount : 0,
    violationsCount: session ? session.violations.length : 0,
    violations: session ? session.violations : [],
    status: (session && session.status === 'BLOCKED') ? 'DISQUALIFIED' : 'PASSED',
    submittedAt: new Date().toISOString()
  };

  store.results.push(resultRecord);
  if (session) {
    session.status = 'COMPLETED';
    session.finalScore = percentage;
  }

  writeStore(store);

  res.json({ success: true, result: resultRecord });
});

// 7. Student Unblock via Master Admin Code (Local on screen)
app.post('/api/exam/admin-code-unblock', (req, res) => {
  const { username, quizId, masterCode } = req.body;
  const store = readStore();

  if (masterCode !== 'UNLOCK2026' && masterCode !== store.admin.password) {
    return res.status(401).json({ success: false, message: 'Invalid Admin Unlock Code.' });
  }

  const sessionKey = `${username}_${quizId}`;
  const session = store.sessions[sessionKey];

  if (session) {
    session.status = 'IN_PROGRESS';
    session.tabSwitchCount = 0; // Reset tab count after unblock
    session.unblockedAt = new Date().toISOString();
    writeStore(store);
    broadcastToStudent(username, { type: 'EXAM_UNBLOCKED', session });
  }

  res.json({ success: true, message: 'Student successfully unblocked.' });
});

// Admin Remote Unblock Student Endpoint
app.post(['/api/admin/unblock-student', '/admin/unblock-student'], (req, res) => {
  const { sessionKey, username } = req.body;
  const store = readStore();

  let targetSessionKey = sessionKey;
  if (!targetSessionKey && username) {
    const cleanUser = username.toLowerCase().trim();
    for (const [sKey, sess] of Object.entries(store.sessions || {})) {
      if ((sess.username || '').toLowerCase() === cleanUser || (sess.rollNumber || '').toLowerCase().split('@')[0] === cleanUser) {
        targetSessionKey = sKey;
        break;
      }
    }
  }

  const session = store.sessions[targetSessionKey];
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session record not found.' });
  }

  session.status = 'IN_PROGRESS';
  session.tabSwitchCount = 0;
  session.unblockedAt = new Date().toISOString();
  writeStore(store);

  broadcastToStudent(session.username, { type: 'EXAM_UNBLOCKED', session });

  res.json({ success: true, message: `Candidate ${session.studentName || session.username} unblocked successfully!` });
});

// Real-Time Session Status Polling Endpoint (for Vercel Serverless Sync)
app.get(['/api/exam/session-status', '/exam/session-status'], (req, res) => {
  const { username, quizId } = req.query;
  const store = readStore();
  
  const cleanUser = (username || '').toLowerCase().trim();
  const cleanRoll = cleanUser.split('@')[0];

  let session = null;
  for (const [key, sess] of Object.entries(store.sessions || {})) {
    const sUser = (sess.username || '').toLowerCase();
    const sRoll = (sess.rollNumber || '').toLowerCase().split('@')[0];
    if ((sUser === cleanUser || sRoll === cleanRoll) && (!quizId || sess.quizId === quizId)) {
      session = sess;
      break;
    }
  }

  if (!session) {
    return res.json({ success: false, message: 'Session not found.' });
  }

  res.json({ success: true, session });
});

// 8. Admin Upload Excel / CSV Roster & Auto-Generate Credentials
app.post('/api/admin/upload-roster', upload.single('rosterFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname.toLowerCase();
  const rawRows = [];

  try {
    // Read Excel (.xlsx, .xls) or CSV using XLSX
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    // Clean up temporary uploaded file
    try { fs.unlinkSync(filePath); } catch (e) {}

    rows.forEach(row => {
      // Flexibly extract student Name and Roll Number from row keys
      const keys = Object.keys(row);
      let name = '';
      let rollNumber = '';

      // Check common column names
      for (const k of keys) {
        const lowerK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lowerK.includes('name') || lowerK.includes('student')) {
          name = String(row[k]).trim();
        } else if (lowerK.includes('roll') || lowerK.includes('id') || lowerK.includes('email') || lowerK.includes('reg')) {
          rollNumber = String(row[k]).trim();
        }
      }

      // Fallbacks if header names differ
      if (!name && keys.length >= 1) name = String(row[keys[0]]).trim();
      if (!rollNumber && keys.length >= 2) rollNumber = String(row[keys[1]]).trim();
      if (!rollNumber) rollNumber = `REG-${Math.floor(1000 + Math.random() * 9000)}`;

      if (name && name !== 'undefined' && name !== 'null') {
        rawRows.push({ name, rollNumber });
      }
    });

    const store = readStore();
    const newCredentials = [];

    rawRows.forEach(item => {
      const cleanRoll = (item.rollNumber || '').trim().toLowerCase();
      const cleanReg = cleanRoll.split('@')[0];

      // Check if candidate already exists in store by Register Number or Roll Number
      const existingStudent = (store.students || []).find(s => {
        const sRoll = (s.rollNumber || '').trim().toLowerCase();
        const sReg = sRoll.split('@')[0];
        return sRoll === cleanRoll || (cleanReg && sReg === cleanReg);
      });

      if (existingStudent) {
        // Update existing candidate details without creating duplicates or changing username
        existingStudent.name = item.name;
        existingStudent.rollNumber = item.rollNumber;
        newCredentials.push(existingStudent);
      } else {
        // Create new unique candidate
        const sanitizedName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.');
        let baseUsername = sanitizedName;
        if (baseUsername.length < 3) baseUsername = `candidate.${cleanReg.replace(/[^a-z0-9]/g, '')}`;

        let finalUsername = baseUsername;
        let count = 1;
        while ((store.students || []).some(s => s.username === finalUsername)) {
          finalUsername = `${baseUsername}.${count}`;
          count++;
        }

        const generatedPassword = generatePassword(8);
        const studentObj = {
          id: 'stu-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          name: item.name,
          rollNumber: item.rollNumber,
          username: finalUsername,
          password: generatedPassword,
          createdAt: new Date().toISOString()
        };

        store.students.push(studentObj);
        newCredentials.push(studentObj);
      }
    });

    writeStore(store);

    res.json({
      success: true,
      count: newCredentials.length,
      credentials: newCredentials
    });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (e) {}
    console.error('Roster Parse Error:', err);
    res.status(500).json({ success: false, message: `Failed to parse ${fileName} roster file.` });
  }
});

// DOCX XML Paragraph & Line Text Extractor
function extractTextFromDocxBuffer(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const docEntry = zip.getEntries().find(e => e.entryName === 'word/document.xml');

    if (docEntry) {
      const xmlText = docEntry.getData().toString('utf8');
      // Split by paragraph tags <w:p>
      const paragraphs = xmlText.split(/<\/w:p>/gi);
      const lines = [];

      paragraphs.forEach(pXml => {
        const matches = pXml.match(/<w:t[^>]*>(.*?)<\/w:t>/gi);
        if (matches && matches.length > 0) {
          const lineText = matches.map(m => m.replace(/<[^>]+>/g, '')).join('').trim();
          if (lineText.length > 0) lines.push(lineText);
        }
      });

      if (lines.length > 0) {
        return lines.join('\n');
      }
    }
  } catch (e) {
    console.error('Docx ZIP parse error:', e.message);
  }

  // Fallback text extraction
  const rawStr = buffer.toString('utf8');
  const matches = rawStr.match(/<w:t[^>]*>(.*?)<\/w:t>/gi);
  if (matches && matches.length > 0) {
    return matches.map(m => m.replace(/<[^>]+>/g, '')).join('\n');
  }
  return rawStr.replace(/[^\x20-\x7E\r\n]/g, ' ');
}

// Helper to extract clean option texts from a line
function extractOptionsFromLine(line) {
  return line
    .split(/(?:^|\s+)(?:[a-dA-D1-4][\.\)]|\([a-dA-D1-4]\)|Option\s*[a-dA-D1-4]:?)\s*/i)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// DOCX & Text Question & Options Layout Parser (Supports Alphabetic & Numerical Options 1. 2. 3. 4. / 1) 2) 3) 4))
function parseQuestionsFromText(text, optionFormat = 'auto') {
  if (!text) return [];

  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const questions = [];
  let currentQ = null;

  rawLines.forEach(line => {
    if (line.toLowerCase() === 'sample quiz' || line.startsWith('PK') || line.includes('[Content_Types]')) return;

    const isQuestionPrefix = line.match(/^(?:Q(?:uestion)?\s*\d+[:.]?|\d+[\.\)]|\?\s*)\s*(.*)/i);
    const isExplicitOptionPrefix = line.match(/^(?:[A-Da-d][\.\)]|\([A-Da-d]\)|Option\s*[A-Da-d1-4]:?)\s*/i);

    // If currentQ has no options yet and line starts with "1." or "1)", it's Option 1!
    const isNumOption1 = currentQ && currentQ.options.length === 0 && line.match(/^(?:1[\.\)]|\(1\))\s*/);

    if (currentQ && currentQ.options.length < 4 && (isExplicitOptionPrefix || isNumOption1 || (currentQ.options.length > 0 && line.match(/^(?:[2-4][\.\)]|\([2-4]\))\s*/)))) {
      const extractedOpts = extractOptionsFromLine(line);
      extractedOpts.forEach(opt => {
        if (currentQ.options.length < 4) {
          currentQ.options.push(opt);
        }
      });
      return;
    }

    if (isQuestionPrefix) {
      if (currentQ && currentQ.text && (currentQ.options.length >= 2 || !isNumOption1)) {
        while (currentQ.options.length < 4) currentQ.options.push('N/A');
        questions.push(currentQ);

        currentQ = {
          id: 'q-' + Date.now() + '-' + questions.length,
          text: isQuestionPrefix[1].trim() || line,
          options: [],
          correctAnswer: 0
        };
        return;
      }
    }

    if (currentQ) {
      if (currentQ.options.length < 4) {
        const extractedOpts = extractOptionsFromLine(line);
        if (extractedOpts.length > 0) {
          extractedOpts.forEach(opt => {
            if (currentQ.options.length < 4) currentQ.options.push(opt);
          });
        } else {
          currentQ.text += ' ' + line;
        }
      } else {
        currentQ.text += ' ' + line;
      }
    } else {
      currentQ = {
        id: 'q-' + Date.now() + '-' + questions.length,
        text: line,
        options: [],
        correctAnswer: 0
      };
    }
  });

  if (currentQ && currentQ.text) {
    while (currentQ.options.length < 4) currentQ.options.push('N/A');
    questions.push(currentQ);
  }

  return questions;
}

// Admin Upload & Parse Questions Document (.docx, .pdf, .txt, .csv, .xlsx, .json)
app.post(['/api/admin/upload-questions', '/admin/upload-questions'], upload.single('questionFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No question document uploaded.' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname.toLowerCase();
  const optionFormat = req.body.optionFormat || 'auto';
  let questions = [];

  try {
    if (fileName.endsWith('.json')) {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } else if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      rows.forEach((row, idx) => {
        const keys = Object.keys(row);
        const qText = row.Question || row.text || row[keys[0]] || `Question ${idx + 1}`;
        const opt1 = row.Option1 || row['Option 1'] || row.A || row[keys[1]] || 'Option A';
        const opt2 = row.Option2 || row['Option 2'] || row.B || row[keys[2]] || 'Option B';
        const opt3 = row.Option3 || row['Option 3'] || row.C || row[keys[3]] || 'Option C';
        const opt4 = row.Option4 || row['Option 4'] || row.D || row[keys[4]] || 'Option D';
        
        let correct = 0;
        const ans = String(row.CorrectAnswer || row.Answer || row.correct || row[keys[5]] || 'A').toUpperCase();
        if (ans === 'B' || ans === '1') correct = 1;
        else if (ans === 'C' || ans === '2') correct = 2;
        else if (ans === 'D' || ans === '3') correct = 3;

        questions.push({
          id: `q-${Date.now()}-${idx}`,
          text: String(qText).trim(),
          options: [String(opt1).trim(), String(opt2).trim(), String(opt3).trim(), String(opt4).trim()],
          correctAnswer: correct
        });
      });
    } else {
      // DOCX, TXT, PDF text parsing
      const fileBuffer = fs.readFileSync(filePath);
      let rawText = '';

      if (fileName.endsWith('.docx')) {
        rawText = extractTextFromDocxBuffer(fileBuffer);
      } else {
        rawText = fileBuffer.toString('utf8');
      }

      questions = parseQuestionsFromText(rawText, optionFormat);
    }

    try { fs.unlinkSync(filePath); } catch (e) {}

    if (!questions || questions.length === 0) {
      return res.status(400).json({ success: false, message: `Could not parse questions from ${fileName}.` });
    }

    res.json({
      success: true,
      count: questions.length,
      questions
    });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (e) {}
    console.error('Question Parse Error:', err);
    res.status(500).json({ success: false, message: `Failed to parse ${fileName} file.` });
  }
});

// Admin Download Sample CSV Question Template
app.get(['/api/admin/sample-question-template', '/admin/sample-question-template'], (req, res) => {
  const sampleCsv = `Question,Option1,Option2,Option3,Option4,CorrectAnswer\nWhat is the capital of France?,Paris,London,Berlin,Madrid,A\nWhich planet is known as the Red Planet?,Venus,Mars,Jupiter,Saturn,B\nWhat is 5 + 7?,10,11,12,13,C\nWho wrote Hamlet?,Charles Dickens,William Shakespeare,Mark Twain,Leo Tolstoy,B\n`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Sample_Quiz_Questions_Template.csv');
  res.status(200).send(sampleCsv);
});

// Admin Clean Up Duplicate Candidate Credentials
app.post(['/api/admin/deduplicate-candidates', '/admin/deduplicate-candidates'], (req, res) => {
  const store = readStore();
  const uniqueStudents = [];
  const seenRolls = new Set();
  let removedCount = 0;

  (store.students || []).forEach(s => {
    const cleanRoll = (s.rollNumber || '').trim().toLowerCase();
    const cleanReg = cleanRoll.split('@')[0];
    const key = cleanReg || cleanRoll || s.username;

    if (!seenRolls.has(key)) {
      seenRolls.add(key);
      uniqueStudents.push(s);
    } else {
      removedCount++;
    }
  });

  store.students = uniqueStudents;
  writeStore(store);

  res.json({
    success: true,
    message: `Successfully deduplicated roster! Removed ${removedCount} duplicate entries.`,
    count: uniqueStudents.length,
    students: uniqueStudents
  });
});

// Admin Reset System Data (Clear sessions/results or Full Reset)
app.post(['/api/admin/reset-database', '/admin/reset-database'], (req, res) => {
  const { resetType } = req.body; // 'SESSIONS_ONLY' or 'FULL_RESET'
  const store = readStore();

  if (resetType === 'FULL_RESET') {
    store.quizzes = [];
    store.students = [];
    store.sessions = {};
    store.results = [];
  } else {
    // Default: Clear all active telemetry sessions & exam results
    store.sessions = {};
    store.results = [];
  }

  writeStore(store);

  res.json({
    success: true,
    message: resetType === 'FULL_RESET' ? 'Full platform database reset completed.' : 'Telemetry sessions and exam results cleared successfully.',
    store
  });
});

// 9. Admin Get Student Credentials JSON List
app.get(['/api/admin/credentials', '/admin/credentials'], (req, res) => {
  const store = readStore();
  res.json(store.students || []);
});

// Admin Get Live Proctoring Sessions List
app.get(['/api/admin/sessions', '/admin/sessions', '/api/admin/live-sessions', '/admin/live-sessions'], (req, res) => {
  const store = readStore();
  const sessions = Object.values(store.sessions || {});
  res.json(sessions);
});

// Admin Remote Unblock Candidate Session
app.post(['/api/admin/unblock', '/admin/unblock', '/api/admin/unblock-student', '/admin/unblock-student'], (req, res) => {
  const { sessionKey, username } = req.body;
  const store = readStore();

  let session = null;
  if (sessionKey && store.sessions[sessionKey]) {
    session = store.sessions[sessionKey];
  } else if (username) {
    const key = Object.keys(store.sessions).find(k => (store.sessions[k].username || '').toLowerCase() === username.toLowerCase());
    if (key) session = store.sessions[key];
  }

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found for unblock.' });
  }

  session.status = 'IN_PROGRESS';
  session.tabSwitchCount = 0;
  session.violations = [];
  session.unblockedAt = new Date().toISOString();
  delete session.blockedAt;
  delete session.blockedReason;

  writeStore(store);

  // Broadcast WebSocket unblock signal to candidate's browser (Chrome/Edge)
  broadcastToStudent(session.username, {
    type: 'EXAM_UNBLOCKED',
    session
  });

  res.json({ success: true, message: 'Candidate unblocked successfully.', session });
});

// Admin Delete Student Credential
app.delete('/api/admin/credentials/:id', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  store.students = store.students.filter(s => s.id !== id);
  writeStore(store);
  res.json({ success: true, message: 'Candidate deleted.' });
});

// Admin Delete Live Session
app.delete('/api/admin/sessions/:sessionKey', (req, res) => {
  const { sessionKey } = req.params;
  const store = readStore();
  delete store.sessions[sessionKey];
  writeStore(store);
  res.json({ success: true, message: 'Session deleted.' });
});

// Admin Delete Exam Result
app.delete('/api/admin/results/:id', (req, res) => {
  const { id } = req.params;
  const store = readStore();
  store.results = store.results.filter(r => r.id !== id);
  writeStore(store);
  res.json({ success: true, message: 'Result record deleted.' });
});

// 10. Admin Download Credentials CSV
app.get('/api/admin/download-credentials', (req, res) => {
  const store = readStore();
  
  let csvContent = 'ID,Student Name,Roll Number / Email,Generated Username,Generated Password,Created Date\n';
  store.students.forEach(s => {
    const name = `"${(s.name || '').replace(/"/g, '""')}"`;
    const roll = `"${(s.rollNumber || '').replace(/"/g, '""')}"`;
    csvContent += `${s.id},${name},${roll},${s.username},${s.password},${s.createdAt}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Student_Credentials_List.csv');
  res.status(200).send(csvContent);
});

// IST Timezone Formatter Helper
function formatTimestampIST(isoString) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return new Date(isoString).toLocaleTimeString();
  }
}

// Admin Get Candidate Attendance & Participation Summary
app.get(['/api/admin/candidate-attendance', '/admin/candidate-attendance'], (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  let completedCount = 0;
  let inProgressCount = 0;
  let blockedCount = 0;
  let notStartedCount = 0;

  const attendanceList = students.map(s => {
    const username = (s.username || '').toLowerCase();
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);

    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) activeSession = sess;
    });

    let status = 'NOT_STARTED';
    let score = 'N/A';
    let timeInfo = 'Haven\'t Taken Test';

    if (resultRecord) {
      status = 'COMPLETED';
      completedCount++;
      score = `${resultRecord.percentage}% (${resultRecord.score}/${resultRecord.totalQuestions})`;
      timeInfo = formatTimestampIST(resultRecord.submittedAt);
    } else if (activeSession) {
      if (activeSession.status === 'BLOCKED') {
        status = 'BLOCKED';
        blockedCount++;
        timeInfo = 'Exam Suspended';
      } else {
        status = 'IN_PROGRESS';
        inProgressCount++;
        timeInfo = 'Active Testing';
      }
      score = 'In Progress';
    } else {
      notStartedCount++;
    }

    return {
      name: s.name,
      rollNumber: s.rollNumber,
      username: s.username,
      status,
      score,
      timeInfo
    };
  });

  res.json({
    success: true,
    completedCount,
    inProgressCount,
    blockedCount,
    notStartedCount,
    attendanceList
  });
});

// Admin Download Attendance CSV Report
app.get('/api/admin/download-attendance', (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  let csvContent = 'Candidate Name,Register Number,Username,Status,Score,Time Info\n';

  students.forEach(s => {
    const username = (s.username || '').toLowerCase();
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);

    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) activeSession = sess;
    });

    let status = 'NOT_STARTED';
    let score = 'N/A';
    let timeInfo = 'Haven\'t Taken Test';

    if (resultRecord) {
      status = 'COMPLETED';
      score = `${resultRecord.percentage}%`;
      timeInfo = formatTimestampIST(resultRecord.submittedAt);
    } else if (activeSession) {
      status = activeSession.status === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
      timeInfo = activeSession.status === 'BLOCKED' ? 'Suspended' : 'Active';
    }

    const regNum = (s.rollNumber || '').split('@')[0];
    csvContent += `"${s.name}","${regNum}","${s.username}","${status}","${score}","${timeInfo}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Candidate_Attendance_Report.csv');
  res.status(200).send(csvContent);
});

// 10. Admin Get Live Sessions & Unblock Control
app.get('/api/admin/live-sessions', (req, res) => {
  const store = readStore();
  res.json(Object.values(store.sessions));
});

// 11. Admin Unblock Student Remote Action
app.post('/api/admin/unblock-student', (req, res) => {
  const { sessionKey } = req.body;
  const store = readStore();
  const session = store.sessions[sessionKey];

  if (!session) {
    return res.status(404).json({ success: false, message: 'Student session not found.' });
  }

  session.status = 'IN_PROGRESS';
  session.tabSwitchCount = 0; // Reset violations
  writeStore(store);

  // Broadcast real-time WebSocket unblock signal to student
  broadcastToStudent(session.username, { type: 'EXAM_UNBLOCKED', session });

  res.json({ success: true, message: `Successfully unblocked ${session.studentName}.` });
});

// 12. Admin Get Scores & Results (Maintains Exact Candidate Directory Order)
app.get(['/api/admin/results', '/admin/results'], (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  const scoresList = students.map((stu, idx) => {
    const username = (stu.username || '').toLowerCase();

    // 1. Check if candidate completed exam
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);

    // 2. Check if candidate has active/ongoing session
    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) {
        activeSession = sess;
      }
    });

    let status = 'NOT ATTEMPTED';
    let scoreDisplay = 'N/A';
    let durationDisplay = 'N/A';
    let violationsCount = 0;
    let submittedAtDisplay = 'Haven\'t Taken Test';
    let quizTitle = 'N/A';
    let resultId = null;

    if (resultRecord) {
      status = resultRecord.status === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'COMPLETED';
      scoreDisplay = `${resultRecord.percentage}% (${resultRecord.score}/${resultRecord.totalQuestions})`;
      durationDisplay = `${Math.floor((resultRecord.timeSpentSeconds || 0) / 60)}m ${(resultRecord.timeSpentSeconds || 0) % 60}s`;
      violationsCount = resultRecord.violationsCount || 0;
      submittedAtDisplay = formatTimestampIST(resultRecord.submittedAt);
      quizTitle = resultRecord.quizTitle || 'Assessment';
      resultId = resultRecord.id;
    } else if (activeSession) {
      if (activeSession.status === 'BLOCKED') {
        status = 'BLOCKED';
        submittedAtDisplay = 'Exam Suspended';
      } else {
        status = 'IN_PROGRESS';
        submittedAtDisplay = 'Active Session';
      }
      scoreDisplay = 'In Progress';
      durationDisplay = 'Testing...';
      violationsCount = activeSession.tabSwitchCount || 0;
      quizTitle = activeSession.quizTitle || 'Assessment';
    }

    return {
      sNo: idx + 1,
      id: stu.id,
      studentName: stu.name,
      rollNumber: stu.rollNumber,
      username: stu.username,
      quizTitle,
      scoreDisplay,
      durationDisplay,
      violationsCount,
      status,
      submittedAtDisplay,
      resultId
    };
  });

  res.json(scoresList);
});

// 13. Admin Download Scores CSV (Maintains Exact Candidate Directory Order)
app.get('/api/admin/download-scores', (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  let csvContent = 'S.No,Candidate Name,Register No / Email,Username,Assessment Title,Score %,Duration,Violations,Status,Submission Date\n';

  students.forEach((stu, idx) => {
    const sNo = idx + 1;
    const username = (stu.username || '').toLowerCase();
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);

    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) {
        activeSession = sess;
      }
    });

    let status = 'NOT ATTEMPTED';
    let scoreDisplay = 'N/A';
    let durationDisplay = 'N/A';
    let violations = 0;
    let dateDisplay = 'Haven\'t Taken Test';
    let quizTitle = 'N/A';

    if (resultRecord) {
      status = resultRecord.status === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'COMPLETED';
      scoreDisplay = `${resultRecord.percentage}% (${resultRecord.score}/${resultRecord.totalQuestions})`;
      durationDisplay = `${Math.floor((resultRecord.timeSpentSeconds || 0) / 60)}m ${(resultRecord.timeSpentSeconds || 0) % 60}s`;
      violations = resultRecord.violationsCount || 0;
      dateDisplay = new Date(resultRecord.submittedAt).toLocaleString();
      quizTitle = resultRecord.quizTitle || 'Assessment';
    } else if (activeSession) {
      status = activeSession.status === 'BLOCKED' ? 'SUSPENDED / BLOCKED' : 'IN PROGRESS';
      scoreDisplay = 'In Progress';
      durationDisplay = 'Testing...';
      violations = activeSession.tabSwitchCount || 0;
      dateDisplay = activeSession.status === 'BLOCKED' ? 'Exam Suspended' : 'Active Session';
      quizTitle = activeSession.quizTitle || 'Assessment';
    }

    const nameStr = `"${(stu.name || '').replace(/"/g, '""')}"`;
    const regStr = `"${(stu.rollNumber || '').replace(/"/g, '""')}"`;
    const userStr = `"${(stu.username || '').replace(/"/g, '""')}"`;
    const titleStr = `"${(quizTitle || '').replace(/"/g, '""')}"`;
    const scoreStr = `"${scoreDisplay}"`;
    const durStr = `"${durationDisplay}"`;
    const dateStr = `"${dateDisplay}"`;

    csvContent += `${sNo},${nameStr},${regStr},${userStr},${titleStr},${scoreStr},${durStr},${violations},"${status}",${dateStr}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Exam_Results_Summary.csv');
  res.status(200).send(csvContent);
});

// 14. Admin Get Candidate Attendance Monitoring Data
app.get('/api/admin/candidate-attendance', (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  const attendanceList = students.map(stu => {
    const username = stu.username.toLowerCase();
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);
    
    // Find active session
    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) {
        activeSession = sess;
      }
    });

    let status = 'NOT_STARTED'; // NOT_STARTED, IN_PROGRESS, BLOCKED, COMPLETED
    let score = 'N/A';
    let timeInfo = 'Haven\'t taken test';

    if (resultRecord) {
      status = 'COMPLETED';
      score = `${resultRecord.score}/${resultRecord.totalQuestions} (${resultRecord.percentage}%)`;
      timeInfo = new Date(resultRecord.submittedAt).toLocaleString();
    } else if (activeSession) {
      if (activeSession.status === 'BLOCKED') {
        status = 'BLOCKED';
        timeInfo = 'Exam Suspended';
      } else {
        status = 'IN_PROGRESS';
        timeInfo = 'Active Testing';
      }
    }

    return {
      id: stu.id,
      name: stu.name,
      rollNumber: stu.rollNumber,
      username: stu.username,
      status,
      score,
      timeInfo
    };
  });

  res.json({
    totalCandidates: students.length,
    completedCount: attendanceList.filter(a => a.status === 'COMPLETED').length,
    inProgressCount: attendanceList.filter(a => a.status === 'IN_PROGRESS').length,
    blockedCount: attendanceList.filter(a => a.status === 'BLOCKED').length,
    notStartedCount: attendanceList.filter(a => a.status === 'NOT_STARTED').length,
    attendanceList
  });
});

// 15. Admin Download Attendance CSV
app.get('/api/admin/download-attendance', (req, res) => {
  const store = readStore();
  const students = store.students || [];
  const results = store.results || [];
  const sessions = store.sessions || {};

  let csvContent = 'S.No,Candidate Name,Register No,Status,Score,Activity Time\n';

  students.forEach((stu, idx) => {
    const sNo = idx + 1;
    const username = stu.username.toLowerCase();
    const resultRecord = results.find(r => (r.username || '').toLowerCase() === username);
    
    let activeSession = null;
    Object.values(sessions).forEach(sess => {
      if ((sess.username || '').toLowerCase() === username) {
        activeSession = sess;
      }
    });

    let status = 'NOT_STARTED';
    let score = 'N/A';
    let timeInfo = 'Haven\'t taken test';

    if (resultRecord) {
      status = 'COMPLETED';
      score = `${resultRecord.score}/${resultRecord.totalQuestions} (${resultRecord.percentage}%)`;
      timeInfo = new Date(resultRecord.submittedAt).toLocaleString();
    } else if (activeSession) {
      status = activeSession.status === 'BLOCKED' ? 'BLOCKED' : 'IN_PROGRESS';
      timeInfo = activeSession.status === 'BLOCKED' ? 'Suspended' : 'In Progress';
    }

    const nameStr = `"${(stu.name || '').replace(/"/g, '""')}"`;
    const regStr = `"${(stu.rollNumber || '').replace(/"/g, '""')}"`;
    const scoreStr = `"${score}"`;
    const timeStr = `"${timeInfo}"`;

    csvContent += `${sNo},${nameStr},${regStr},${status},${scoreStr},${timeStr}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Candidate_Attendance_Report.csv');
  res.status(200).send(csvContent);
});

// Helper to parse correct answer keys flexibly from A/a, B/b, C/c, D/d or 0, 1, 2, 3
function parseCorrectAnswerKey(val) {
  if (val === undefined || val === null) return 0;
  const str = String(val).trim().toUpperCase();
  if (str === 'A' || str === '0' || str === '1)' || str === 'A)' || str === 'OPTION A' || str === 'OPTION 1') return 0;
  if (str === 'B' || str === '1' || str === '2)' || str === 'B)' || str === 'OPTION B' || str === 'OPTION 2') return 1;
  if (str === 'C' || str === '2' || str === '3)' || str === 'C)' || str === 'OPTION C' || str === 'OPTION 3') return 2;
  if (str === 'D' || str === '3' || str === '4)' || str === 'D)' || str === 'OPTION D' || str === 'OPTION 4') return 3;
  const num = parseInt(str, 10);
  if (!isNaN(num)) return Math.min(Math.max(num, 0), 3);
  return 0;
}

// Intelligent Line-by-Line Question & Option Parser (Supports Numerical 1. 2. 3. 4. and Alphabetic A. B. C. D.)
function parseQuestionsFromRawText(rawText, optionFormat = 'auto') {
  const parsedQuestions = [];
  if (!rawText) return parsedQuestions;

  // Clean line endings and common header noise
  const cleanText = rawText.replace(/\r\n/g, '\n').replace(/Sample Quiz/gi, '').trim();
  if (!cleanText) return parsedQuestions;

  // Auto-Detect Option Format if set to 'auto'
  let format = optionFormat;
  if (format === 'auto') {
    const hasAlphabetic = /[a-dA-D][\)\.-]\s+/.test(cleanText);
    const hasNumericOpts = /\b1[\)\.-]\s+.*\b2[\)\.-]\s+/.test(cleanText);
    if (!hasAlphabetic && hasNumericOpts) {
      format = 'numeric';
    } else {
      format = 'alphabetic';
    }
  }

  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let currentQuestion = null;

  lines.forEach(line => {
    // Check if line is a Question Header (starts with Q1., Item 1:, 1.what..., 2.who...)
    const qHeaderMatch = line.match(/^(?:Q\d+[\.:]|Item\s*\d+[\.:]|\b\d+[\.:\)])\s*(.*)/i);
    const containsMultipleOpts = /\b1[\)\.-]\s+.*\b2[\)\.-]\s+/.test(line);
    const containsAlphabeticOpts = /\b[a-bA-B][\)\.-]\s+.*\b[b-cB-C][\)\.-]\s+/.test(line);

    const isQuestionLine = qHeaderMatch && 
      !containsMultipleOpts && 
      !containsAlphabeticOpts && 
      (line.includes('?') || !currentQuestion || currentQuestion.options.length >= 4);

    if (isQuestionLine) {
      if (currentQuestion && currentQuestion.text) {
        parsedQuestions.push(currentQuestion);
      }

      let qText = line.replace(/^(?:Q\d+[\.:]|Item\s*\d+[\.:]|\b\d+[\.:\)])\s*/i, '').trim();
      currentQuestion = {
        id: 'q-' + Date.now() + '-' + parsedQuestions.length,
        text: qText,
        options: [],
        correctAnswer: 0
      };
    } else if (currentQuestion) {
      // Split options on line (side-by-side or multi-line)
      let parts = [];
      if (format === 'numeric') {
        parts = line.split(/(?=\b[1-4][\)\.-]\s*)/g);
      } else {
        parts = line.split(/(?=\b[a-dA-D1-4][\)\.-]\s*)/g);
      }

      parts.forEach(part => {
        const m = part.match(/^(?:[1-4a-dA-D][\)\.-]|\([1-4a-dA-D]\))\s*(.*)/i);
        if (m) {
          let optVal = m[1].replace(/(?:Answer|Ans|Correct|Key)[\s:]*([A-Da-d1-4]).*/i, '').trim();
          // Remove sub-segment if inline
          if (format === 'numeric') {
            optVal = optVal.split(/\s+[2-4][\)\.-]\s+/)[0].trim();
          } else {
            optVal = optVal.split(/\s+[b-dB-D][\)\.-]\s+/)[0].trim();
          }
          if (optVal && optVal !== currentQuestion.text && currentQuestion.options.length < 4) {
            currentQuestion.options.push(optVal);
          }
        } else if (part.trim() && currentQuestion.options.length < 4 && part.trim() !== currentQuestion.text) {
          let fallback = part.replace(/(?:Answer|Ans|Correct|Key)[\s:]*([A-Da-d1-4]).*/i, '').trim();
          if (fallback) currentQuestion.options.push(fallback);
        }

        // Check Answer Key
        const ansMatch = part.match(/(?:Answer|Ans|Correct|Key)[\s:]*([A-Da-d1-4])/i);
        if (ansMatch) {
          currentQuestion.correctAnswer = parseCorrectAnswerKey(ansMatch[1]);
        }
      });
    }
  });

  if (currentQuestion && currentQuestion.text) {
    parsedQuestions.push(currentQuestion);
  }

  // Ensure 4 option slots for every question
  parsedQuestions.forEach(q => {
    while (q.options.length < 4) {
      q.options.push(`Option ${q.options.length + 1}`);
    }
    q.options = q.options.slice(0, 4);
  });

  return parsedQuestions;
}

// 14. Admin Upload Questions (PDF, Word DOCX, TXT, CSV, JSON)
app.post('/api/admin/upload-questions', upload.single('questionFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname.toLowerCase();
  const optionFormat = req.body.optionFormat || 'auto';
  let parsedQuestions = [];

  try {
    // 1. PDF File Parsing
    if (fileName.endsWith('.pdf')) {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      try { fs.unlinkSync(filePath); } catch (e) {}
      parsedQuestions = parseQuestionsFromRawText(pdfData.text, optionFormat);
      return res.json({ success: true, format: 'PDF', count: parsedQuestions.length, questions: parsedQuestions });
    }

    // 2. Word DOCX File Parsing
    if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
      const docxResult = await mammoth.extractRawText({ path: filePath });
      try { fs.unlinkSync(filePath); } catch (e) {}
      parsedQuestions = parseQuestionsFromRawText(docxResult.value, optionFormat);
      return res.json({ success: true, format: 'Word', count: parsedQuestions.length, questions: parsedQuestions });
    }

    // 3. Plain Text File Parsing (.txt)
    if (fileName.endsWith('.txt')) {
      const txtContent = fs.readFileSync(filePath, 'utf8');
      try { fs.unlinkSync(filePath); } catch (e) {}
      parsedQuestions = parseQuestionsFromRawText(txtContent, optionFormat);
      return res.json({ success: true, format: 'TXT', count: parsedQuestions.length, questions: parsedQuestions });
    }

    // 4. JSON File Parsing
    if (fileName.endsWith('.json')) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const jsonArr = JSON.parse(raw);
      fs.unlinkSync(filePath);

      jsonArr.forEach((item, idx) => {
        parsedQuestions.push({
          id: 'q-' + Date.now() + '-' + idx,
          text: item.text || item.question || 'Untitled Question',
          options: item.options || [item.option1 || '', item.option2 || '', item.option3 || '', item.option4 || ''],
          correctAnswer: parseCorrectAnswerKey(item.correctAnswer !== undefined ? item.correctAnswer : item.correctIndex)
        });
      });

      return res.json({ success: true, format: 'JSON', count: parsedQuestions.length, questions: parsedQuestions });
    }

    // 5. CSV File Parsing
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row) => {
        const text = row['Question Text'] || row.Question || row.text || Object.values(row)[0] || 'Untitled Question';
        const opt1 = row['Option 1'] || row.Option1 || row.option1 || Object.values(row)[1] || '';
        const opt2 = row['Option 2'] || row.Option2 || row.option2 || Object.values(row)[2] || '';
        const opt3 = row['Option 3'] || row.Option3 || row.option3 || Object.values(row)[3] || '';
        const opt4 = row['Option 4'] || row.Option4 || row.option4 || Object.values(row)[4] || '';
        
        const correctRaw = row['Correct Answer Index (0-3)'] || row['Correct Answer'] || row.CorrectAnswer || row.correctIndex || row.correctAnswer || Object.values(row)[5] || '0';
        const correctAnswer = parseCorrectAnswerKey(correctRaw);

        parsedQuestions.push({
          id: 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          text,
          options: [opt1, opt2, opt3, opt4],
          correctAnswer
        });
      })
      .on('end', () => {
        try { fs.unlinkSync(filePath); } catch (e) {}
        res.json({ success: true, format: 'CSV', count: parsedQuestions.length, questions: parsedQuestions });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(filePath); } catch (e) {}
        res.status(500).json({ success: false, message: 'Error parsing CSV file.' });
      });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (e) {}
    console.error('File parsing error:', err);
    res.status(500).json({ success: false, message: `Failed to parse ${fileName} file.` });
  }
});

// 15. Admin Download Sample Question CSV Template
app.get('/api/admin/download-sample-questions', (req, res) => {
  const samplePath = path.join(__dirname, 'sample_questions.csv');
  if (fs.existsSync(samplePath)) {
    res.download(samplePath, 'Sample_Questions_Template.csv');
  } else {
    res.status(404).json({ success: false, message: 'Sample template file not found.' });
  }
});

// 16. Firebase Firestore Telemetry & Manual Sync Endpoints
app.get('/api/admin/firebase-status', (req, res) => {
  res.json({ success: true, firebase: FirebaseService.getStatus() });
});

app.post('/api/admin/firebase-sync', async (req, res) => {
  const store = readStore();
  const syncResult = await FirebaseService.syncToFirebase(store);
  res.json({ success: true, syncResult, status: FirebaseService.getStatus() });
});

// Serve HTML pages for SPA routes
app.get(['/admin', '/admin/', '/admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get(['/exam', '/exam/', '/exam.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'exam.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('*', (req, res) => {
  const reqPath = (req.path || req.url || '').toLowerCase();
  if (reqPath.includes('admin')) {
    return res.sendFile(path.join(__dirname, 'views', 'admin.html'));
  }
  if (reqPath.includes('exam')) {
    return res.sendFile(path.join(__dirname, 'views', 'exam.html'));
  }
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Export express app for Vercel Serverless Functions
module.exports = app;

// Start Server (only when running directly / non-Vercel environment)
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  SECURE QUIZ LOCKDOWN SERVER READY ON PORT ${PORT}`);
    console.log(`  Student Login: http://localhost:${PORT}`);
    console.log(`  Admin Portal:  http://localhost:${PORT}/admin`);
    console.log(`=======================================================`);
  });
}
