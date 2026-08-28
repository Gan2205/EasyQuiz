const FirebaseService = require('../services/firebaseService');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

async function purgeAllData() {
  console.log('🧹 Purging all test candidates, sessions, results, and quizzes...');

  // Reset store to clean state (preserving only Admin credentials)
  const cleanStore = {
    admin: {
      username: 'SCRS',
      password: 'SCRS@2026'
    },
    quizzes: [],
    students: [],
    sessions: {},
    results: []
  };

  fs.writeFileSync(STORE_PATH, JSON.stringify(cleanStore, null, 2), 'utf8');

  // Purge Firebase Firestore Collections
  console.log('  Clearing Firebase Firestore /quizzes...');
  await FirebaseService.clearFirebaseCollection('quizzes');

  console.log('  Clearing Firebase Firestore /students...');
  await FirebaseService.clearFirebaseCollection('students');

  console.log('  Clearing Firebase Firestore /results...');
  await FirebaseService.clearFirebaseCollection('results');

  console.log('  Clearing Firebase Firestore /sessions...');
  await FirebaseService.clearFirebaseCollection('sessions');

  console.log('✅ ALL DATA PURGED! System is 100% clean for fresh candidate upload.');
}

purgeAllData();
