try {
  console.log('Testing requiring server.js...');
  const server = require('../server');
  console.log('SUCCESSFULLY REQUIRED server.js!');
} catch (e) {
  console.error('ERROR REQUIRING server.js:', e);
}
