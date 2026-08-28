/**
 * Firebase Firestore Data Store Service
 * Manages Firebase Firestore synchronization for quizzes, candidate credentials, live telemetry, and audit results.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_BUILDER);
const STORE_PATH = IS_VERCEL ? path.join('/tmp', 'store.json') : path.join(__dirname, '..', 'data', 'store.json');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studio-8450670559-9edfe';

// Firestore REST API Endpoint Base
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

let isFirebaseConnected = true;
let lastSyncTimestamp = new Date().toISOString();

// Helper for HTTP/HTTPS Requests
function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', (err) => resolve({ error: err }));

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Convert JS Objects to Firestore Field Values
function objectToFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      fields[key] = { integerValue: value };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (Array.isArray(value)) {
      fields[key] = { arrayValue: { values: value.map(v => typeof v === 'object' ? { mapValue: { fields: objectToFirestoreFields(v) } } : { stringValue: String(v) }) } };
    } else if (typeof value === 'object' && value !== null) {
      fields[key] = { mapValue: { fields: objectToFirestoreFields(value) } };
    }
  }
  return fields;
}

// Convert Firestore Field Values back to JS Objects
function firestoreFieldsToObject(fields) {
  const obj = {};
  if (!fields) return obj;

  for (const [key, valObj] of Object.entries(fields)) {
    if (valObj.stringValue !== undefined) obj[key] = valObj.stringValue;
    else if (valObj.integerValue !== undefined) obj[key] = parseInt(valObj.integerValue, 10);
    else if (valObj.booleanValue !== undefined) obj[key] = valObj.booleanValue;
    else if (valObj.mapValue !== undefined) obj[key] = firestoreFieldsToObject(valObj.mapValue.fields);
    else if (valObj.arrayValue !== undefined) {
      obj[key] = (valObj.arrayValue.values || []).map(item => {
        if (item.stringValue !== undefined) return item.stringValue;
        if (item.mapValue !== undefined) return firestoreFieldsToObject(item.mapValue.fields);
        return item;
      });
    }
  }
  return obj;
}

const FirebaseService = {
  getProjectId: () => FIREBASE_PROJECT_ID,

  getStatus: () => ({
    connected: isFirebaseConnected,
    projectId: FIREBASE_PROJECT_ID,
    lastSync: lastSyncTimestamp
  }),

  // Push local store to Firebase Firestore in Parallel Concurrent Waves
  syncToFirebase: async (storeData) => {
    lastSyncTimestamp = new Date().toISOString();
    try {
      const syncTasks = [];

      // 1. Sync Admin Config
      if (storeData.admin) {
        syncTasks.push(makeRequest(`${FIRESTORE_BASE_URL}/config/admin`, 'PATCH', {
          fields: objectToFirestoreFields(storeData.admin)
        }));
      }

      // 2. Sync Quizzes in Parallel
      if (Array.isArray(storeData.quizzes)) {
        storeData.quizzes.forEach(quiz => {
          syncTasks.push(makeRequest(`${FIRESTORE_BASE_URL}/quizzes/${quiz.id}`, 'PATCH', {
            fields: objectToFirestoreFields(quiz)
          }));
        });
      }

      // 3. Sync Students in Parallel
      if (Array.isArray(storeData.students)) {
        storeData.students.forEach(student => {
          syncTasks.push(makeRequest(`${FIRESTORE_BASE_URL}/students/${student.id}`, 'PATCH', {
            fields: objectToFirestoreFields(student)
          }));
        });
      }

      // 4. Sync Results in Parallel
      if (Array.isArray(storeData.results)) {
        storeData.results.forEach(resItem => {
          syncTasks.push(makeRequest(`${FIRESTORE_BASE_URL}/results/${resItem.id}`, 'PATCH', {
            fields: objectToFirestoreFields(resItem)
          }));
        });
      }

      // Execute all Firestore REST updates concurrently
      await Promise.all(syncTasks);

      isFirebaseConnected = true;
      return { success: true, timestamp: lastSyncTimestamp };
    } catch (err) {
      console.warn('Firebase Sync Notice:', err.message);
      return { success: false, error: err.message };
    }
  },

  // Pull documents from Firebase Firestore
  pullFromFirebase: async () => {
    try {
      const storeData = {
        admin: { username: 'SCRS', password: 'SCRS@2026' },
        quizzes: [],
        students: [],
        sessions: {},
        results: []
      };

      // Read /quizzes
      const quizRes = await makeRequest(`${FIRESTORE_BASE_URL}/quizzes`);
      if (quizRes.data && quizRes.data.documents) {
        storeData.quizzes = quizRes.data.documents.map(doc => firestoreFieldsToObject(doc.fields));
      }

      // Read /students
      const studentRes = await makeRequest(`${FIRESTORE_BASE_URL}/students`);
      if (studentRes.data && studentRes.data.documents) {
        storeData.students = studentRes.data.documents.map(doc => firestoreFieldsToObject(doc.fields));
      }

      // Read /results
      const resultRes = await makeRequest(`${FIRESTORE_BASE_URL}/results`);
      if (resultRes.data && resultRes.data.documents) {
        storeData.results = resultRes.data.documents.map(doc => firestoreFieldsToObject(doc.fields));
      }

      if (storeData.quizzes.length > 0 || storeData.students.length > 0) {
        fs.writeFileSync(STORE_PATH, JSON.stringify(storeData, null, 2), 'utf8');
      }

      return { success: true, data: storeData };
    } catch (err) {
      console.warn('Firebase Pull Notice:', err.message);
      return { success: false };
    }
  },

  // Delete single document from Firebase Firestore
  deleteFromFirebase: async (collection, docId) => {
    try {
      await makeRequest(`${FIRESTORE_BASE_URL}/${collection}/${encodeURIComponent(docId)}`, 'DELETE');
      return { success: true };
    } catch (err) {
      console.warn(`Firebase Delete Error (${collection}/${docId}):`, err.message);
      return { success: false };
    }
  },

  // Clear entire collection from Firebase Firestore
  clearFirebaseCollection: async (collection) => {
    try {
      const res = await makeRequest(`${FIRESTORE_BASE_URL}/${collection}`);
      if (res.data && res.data.documents) {
        const deleteTasks = res.data.documents.map(doc => {
          const nameParts = doc.name.split('/');
          const docId = nameParts[nameParts.length - 1];
          return makeRequest(`${FIRESTORE_BASE_URL}/${collection}/${encodeURIComponent(docId)}`, 'DELETE');
        });
        await Promise.all(deleteTasks);
      }
      return { success: true };
    } catch (err) {
      console.warn(`Firebase Clear Error (${collection}):`, err.message);
      return { success: false };
    }
  }
};

module.exports = FirebaseService;
