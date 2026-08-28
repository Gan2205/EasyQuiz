const pdfParseModule = require('pdf-parse');
console.log('pdfParseModule type:', typeof pdfParseModule, Object.keys(pdfParseModule));
const fs = require('fs');
const path = require('path');

// Search for basic_quiz_test_questions.pdf in Downloads or current folder
const downloadsPath = 'C:\\Users\\UPPAL\\Downloads\\basic_quiz_test_questions.pdf';

async function testPdf() {
  if (!fs.existsSync(downloadsPath)) {
    console.log('PDF file not found in Downloads path:', downloadsPath);
    return;
  }

  const fileBuffer = fs.readFileSync(downloadsPath);
  const { PDFParse } = pdfParseModule;
  const parser = new PDFParse({ data: fileBuffer });
  const data = await parser.getText();
  console.log('--- EXTRACTED PDF TEXT ---');
  console.log(data.text || data);
  console.log('--------------------------');
}

testPdf();
