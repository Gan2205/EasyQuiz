const https = require('https');

// Test kvdb.io (Instant free key-value cloud store)
function testKvdb() {
  const bucketId = 'easyquiz_prod_store_2026';
  const data = JSON.stringify({
    students: [
      { id: 'stu-1', username: 'ganesh', password: 'JmFfSJGG', name: 'Ganesh', rollNumber: '99230040791@klu.ac.in' },
      { id: 'stu-2', username: 'dhanush', password: 'XQMfNf4W', name: 'dhanush', rollNumber: '99230040792@klu.ac.in' },
      { id: 'stu-3', username: 'rahul', password: 'z42FL9sk', name: 'rahul', rollNumber: '99230040546@klu.ac.in' }
    ]
  });

  const req = https.request({
    hostname: 'kvdb.io',
    path: `/${bucketId}/store`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('KVDB WRITE STATUS:', res.statusCode, body);

      // Now Read Back
      https.get(`https://kvdb.io/${bucketId}/store`, (getRes) => {
        let getBody = '';
        getRes.on('data', chunk => getBody += chunk);
        getRes.on('end', () => {
          console.log('KVDB READ STATUS:', getRes.statusCode);
          console.log('KVDB READ DATA:', getBody);
        });
      });
    });
  });

  req.on('error', err => console.error('KVDB ERROR:', err));
  req.write(data);
  req.end();
}

testKvdb();
