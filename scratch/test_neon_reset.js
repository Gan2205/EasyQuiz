const NeonService = require('../services/neonService');

async function testReset() {
  console.log('Testing Neon Table Clears...');
  const res1 = await NeonService.clearTable('sessions');
  console.log('CLEAR SESSIONS RESULT:', res1);

  const res2 = await NeonService.clearTable('results');
  console.log('CLEAR RESULTS RESULT:', res2);

  const res3 = await NeonService.clearTable('students');
  console.log('CLEAR STUDENTS RESULT:', res3);

  const res4 = await NeonService.clearTable('quizzes');
  console.log('CLEAR QUIZZES RESULT:', res4);
}

testReset();
