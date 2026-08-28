const https = require('https');

// Test jsonstorage.net free REST API
function testJsonStorage() {
  const data = JSON.stringify({
    students: [
      { id: 'stu-1', username: 'ganesh', password: 'JmFfSJGG', name: 'Ganesh', rollNumber: '99230040791@klu.ac.in' },
      { id: 'stu-2', username: 'dhanush', password: 'XQMfNf4W', name: 'dhanush', rollNumber: '99230040792@klu.ac.in' },
      { id: 'stu-3', username: 'rahul', password: 'z42FL9sk', name: 'rahul', rollNumber: '99230040546@klu.ac.in' }
    ]
  });

  const req = https.request({
    hostname: 'api.jsonstorage.net',
    path: '/v1/json',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('JSONSTORAGE POST STATUS:', res.statusCode, body);
      try {
        const json = JSON.parse(body);
        const uri = json.uri;
        console.log('URI:', uri);

        if (uri) {
          const urlObj = new URL(uri);
          https.get({
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search
          }, (getRes) => {
            let getBody = '';
            getRes.on('data', chunk => getBody += chunk);
            getRes.on('end', () => {
              console.log('JSONSTORAGE GET STATUS:', getRes.statusCode, getBody);
            });
          });
        }
      } catch (e) {
        console.error('PARSE ERROR:', e);
      }
    });
  });

  req.on('error', err => console.error('JSONSTORAGE ERROR:', err));
  req.write(data);
  req.end();
}

testJsonStorage();
