const https = require('https');

const bucket = 'studio-8450670559-9edfe.firebasestorage.app';
const apiKey = 'AIzaSyAvaWG6iZSsqwbZClwcycukPucYW9rexvk';

// Test Firebase Cloud Storage REST API for persistent JSON data
function testFirebaseStorage() {
  const storeData = JSON.stringify({
    admin: { username: 'SCRS', password: 'SCRS@2026' },
    quizzes: [],
    students: [
      { id: 'stu-1', username: 'ganesh', password: 'JmFfSJGG', name: 'Ganesh', rollNumber: '99230040791@klu.ac.in' },
      { id: 'stu-2', username: 'dhanush', password: 'XQMfNf4W', name: 'dhanush', rollNumber: '99230040792@klu.ac.in' },
      { id: 'stu-3', username: 'rahul', password: 'z42FL9sk', name: 'rahul', rollNumber: '99230040546@klu.ac.in' }
    ],
    sessions: {},
    results: []
  });

  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/store.json?name=store.json&key=${apiKey}`;
  const req = https.request(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(storeData)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('UPLOAD STATUS:', res.statusCode, body.slice(0, 300));

      // Read Back
      const readUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/store.json?alt=media&key=${apiKey}`;
      https.get(readUrl, (getRes) => {
        let getBody = '';
        getRes.on('data', chunk => getBody += chunk);
        getRes.on('end', () => {
          console.log('READ STATUS:', getRes.statusCode);
          console.log('READ DATA:', getBody);
        });
      });
    });
  });

  req.on('error', err => console.error('UPLOAD ERROR:', err));
  req.write(storeData);
  req.end();
}

testFirebaseStorage();
