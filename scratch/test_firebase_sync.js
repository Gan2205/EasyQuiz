const FirebaseService = require('../services/firebaseService');

async function testSync() {
  console.log('1. Pushing test student to Firebase Firestore...');
  const testStore = {
    students: [
      {
        id: 'stu-test-rahul',
        name: 'rahul',
        rollNumber: '99230040546@klu.ac.in',
        username: 'rahul',
        password: 'NvS44GNF',
        createdAt: new Date().toISOString()
      }
    ]
  };

  const syncRes = await FirebaseService.syncToFirebase(testStore);
  console.log('Sync result:', syncRes);

  const https = require('https');
  const apiKey = 'AIzaSyAvaWG6iZSsqwbZClwcycukPucYW9rexvk';
  const url = `https://firestore.googleapis.com/v1/projects/studio-8450670559-9edfe/databases/(default)/documents/students?key=${apiKey}`;
  
  https.get(url, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('RAW FIRESTORE BODY:', body);
    });
  });
}

testSync();
