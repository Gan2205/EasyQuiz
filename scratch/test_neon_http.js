const https = require('https');

// Neon Direct HTTP REST SQL Endpoint
const host = 'ep-withered-waterfall-aws9pvnl-pooler.c-12.us-east-1.aws.neon.tech';
const pass = 'npg_oD3bSeg5OMJF';
const db = 'neondb';
const user = 'neondb_owner';

function queryNeonHttp(sqlQuery, params = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query: sqlQuery, params });
    const options = {
      hostname: host,
      path: `/sql`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pass}`,
        'Neon-Connection-String': `postgresql://${user}:${pass}@${host}/${db}?sslmode=require`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(payload);
    req.end();
  });
}

async function testHttp() {
  console.log('Testing Neon Direct HTTP REST Query...');
  try {
    const res = await queryNeonHttp('SELECT COUNT(*) FROM quizzes;');
    console.log('STATUS:', res.status);
    console.log('DATA:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}

testHttp();
