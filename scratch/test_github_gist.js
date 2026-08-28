const https = require('https');

// Test GitHub Gist API for instant cloud store persistence
function testGist() {
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

  const payload = JSON.stringify({
    description: 'EasyQuiz Live Store Persistence',
    public: true,
    files: {
      'store.json': { content: storeData }
    }
  });

  const req = https.request({
    hostname: 'api.github.com',
    path: '/gists',
    method: 'POST',
    headers: {
      'User-Agent': 'EasyQuiz-Platform',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('GIST POST STATUS:', res.statusCode);
      try {
        const json = JSON.parse(body);
        const rawUrl = json.files['store.json'].raw_url;
        const gistId = json.id;
        console.log('GIST ID:', gistId);
        console.log('RAW URL:', rawUrl);

        // Read Back
        https.get(rawUrl, (getRes) => {
          let getBody = '';
          getRes.on('data', chunk => getBody += chunk);
          getRes.on('end', () => {
            console.log('GIST READ STATUS:', getRes.statusCode);
            console.log('GIST READ CONTENT:', getBody);
          });
        });
      } catch (e) {
        console.error('PARSE ERROR:', e, body);
      }
    });
  });

  req.on('error', err => console.error('GIST ERROR:', err));
  req.write(payload);
  req.end();
}

testGist();
