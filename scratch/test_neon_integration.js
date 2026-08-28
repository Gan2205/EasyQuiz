const NeonService = require('../services/neonService');

async function testNeon() {
  console.log('1. Syncing test candidate & quiz to Neon PostgreSQL...');
  const testStore = {
    quizzes: [
      {
        id: 'quiz-neon-test',
        title: 'Neon PostgreSQL Assessment',
        description: 'Testing Neon Serverless DB integration',
        timeLimitMinutes: 15,
        questions: [
          { id: 'q1', text: 'What database engine is EasyQuiz using?', options: ['Firebase', 'Neon PostgreSQL', 'MongoDB', 'SQLite'], correctAnswer: 1 }
        ]
      }
    ],
    students: [
      {
        id: 'stu-neon-rahul',
        name: 'rahul',
        rollNumber: '99230040546@klu.ac.in',
        username: 'rahul',
        password: 'z42FL9sk',
        createdAt: new Date().toISOString()
      }
    ]
  };

  const syncRes = await NeonService.syncToNeon(testStore);
  console.log('Neon Sync Result:', syncRes);

  console.log('2. Pulling data back from Neon PostgreSQL...');
  const pullRes = await NeonService.pullFromNeon();
  console.log('Neon Pull Success:', pullRes.success);
  console.log('Neon Quizzes:', JSON.stringify(pullRes.data ? pullRes.data.quizzes : [], null, 2));
  console.log('Neon Students:', JSON.stringify(pullRes.data ? pullRes.data.students : [], null, 2));
}

testNeon();
