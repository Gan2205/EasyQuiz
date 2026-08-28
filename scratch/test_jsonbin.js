const https = require('https');

// Test npoint.io (Instant free JSON document store)
function testNpoint() {
  const data = JSON.stringify({
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

  const req = https.request({
    hostname: 'api.npoint.io',
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('NPOINT CREATE STATUS:', res.statusCode, body);
      try {
        const json = JSON.parse(body);
        const binId = json.id;
        console.log('BIN ID:', binId);

        // Read Back
        https.get(`https://api.npoint.io/${binId}`, (getRes) => {
          let getBody = '';
          getRes.on('data', chunk => getBody += chunk);
          getRes.on('end', () => {
            console.log('NPOINT READ STATUS:', getRes.statusCode);
            console.log('NPOINT READ DATA:', getBody.slice(0, 200));
          });
        });
      } catch (e) {
        console.error('PARSE ERROR:', e);
      }
    });
  });

  req.on('error', err => console.error('NPOINT ERROR:', err));
  req.write(data);
  req.end();
}

testNpoint();
