const { neon } = require('@neondatabase/serverless');

const NEON_DATABASE_URL = 'postgresql://neondb_owner:npg_oD3bSeg5OMJF@ep-withered-waterfall-aws9pvnl-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function testNeonFetch() {
  console.log('Testing @neondatabase/serverless neon() query...');
  try {
    const sql = neon(NEON_DATABASE_URL);
    const rows = await sql`SELECT count(*) FROM quizzes`;
    console.log('SUCCESS! QUERY ROWS:', rows);
  } catch (e) {
    console.error('NEON FETCH ERROR:', e.message);
  }
}

testNeonFetch();
