const https = require('https');

const projectId = 'studio-8450670559-9edfe';
const apiKey = 'AIzaSyAvaWG6iZSsqwbZClwcycukPucYW9rexvk';

// Test Firebase Realtime Database REST endpoints
const rtdbUrls = [
  `https://${projectId}-default-rtdb.firebaseio.com/store.json?auth=${apiKey}`,
  `https://${projectId}.firebaseio.com/store.json?auth=${apiKey}`,
  `https://${projectId}-default-rtdb.firebaseio.com/store.json`,
  `https://${projectId}.firebaseio.com/store.json`
];

async function testUrl(url) {
  return new Promise(resolve => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ url, status: res.statusCode, body: body.slice(0, 300) });
      });
    }).on('error', err => resolve({ url, error: err.message }));
  });
}

async function runTest() {
  console.log('Testing Firebase Realtime DB REST URLs...');
  for (const url of rtdbUrls) {
    const res = await testUrl(url);
    console.log(`STATUS ${res.status} | URL: ${res.url}`);
    console.log(`BODY: ${res.body}\n`);
  }
}

runTest();
