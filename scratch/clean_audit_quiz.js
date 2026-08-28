const FirebaseService = require('../services/firebaseService');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

async function cleanAuditQuiz() {
  console.log('🧹 Cleaning up audit test quiz from local store and Firebase Firestore...');

  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (e) {
    store = { admin: { username: 'SCRS', password: 'SCRS@2026' }, quizzes: [], students: [], sessions: {}, results: [] };
  }

  // Remove test quizzes with 'Full Audit' or 'quiz-audit' in ID/title
  if (Array.isArray(store.quizzes)) {
    store.quizzes = store.quizzes.filter(q => {
      const isAudit = (q.id || '').includes('audit') || (q.title || '').includes('Audit') || (q.title || '').includes('Full Audit');
      if (isAudit) {
        console.log(`  Deleting audit quiz from Firebase Firestore: ${q.id} (${q.title})`);
        FirebaseService.deleteFromFirebase('quizzes', q.id).catch(() => {});
      }
      return !isAudit;
    });
  }

  // Write updated store back to data/store.json
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');

  // Delete directly from Firebase Firestore just in case
  await FirebaseService.deleteFromFirebase('quizzes', 'quiz-audit-5item');

  console.log('✅ Audit quiz cleanup complete! Remaining Quizzes Count:', store.quizzes.length);
}

cleanAuditQuiz();
