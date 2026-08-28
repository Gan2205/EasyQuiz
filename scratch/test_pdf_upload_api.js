const http = require('http');
const fs = require('fs');
const path = require('path');

const pdfPath = 'C:\\Users\\UPPAL\\Downloads\\basic_quiz_test_questions.pdf';

function testPdfUpload() {
  if (!fs.existsSync(pdfPath)) {
    console.error('PDF file not found at:', pdfPath);
    return;
  }

  const boundary = '--------------------------' + Date.now().toString(16);
  const fileData = fs.readFileSync(pdfPath);
  const fileName = path.basename(pdfPath);

  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="questionFile"; filename="${fileName}"\r\n`;
  body += `Content-Type: application/pdf\r\n\r\n`;

  const payload = Buffer.concat([
    Buffer.from(body, 'utf8'),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  ]);

  const req = http.request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/upload-questions',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length
    }
  }, (res) => {
    let resBody = '';
    res.on('data', chunk => resBody += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      try {
        const json = JSON.parse(resBody);
        console.log('SUCCESS:', json.success);
        console.log('QUESTIONS COUNT:', json.count);
        console.log('SAMPLE QUESTIONS:', JSON.stringify(json.questions, null, 2));
      } catch (e) {
        console.log('RAW RESPONSE:', resBody);
      }
    });
  });

  req.on('error', err => console.error('REQUEST ERROR:', err));
  req.write(payload);
  req.end();
}

testPdfUpload();
