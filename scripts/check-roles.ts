import pg from '../backend/node_modules/pg/lib/index.js';
import dotenv from '../backend/node_modules/dotenv/lib/main.js';
dotenv.config({ path: 'backend/.dev.vars' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  const client = await pool.connect();
  try {
    const user = await client.query('select id, email from identity."user" where email in ($1, $2)', ['admin@lamarseillaise.cm', 'eleve.completion@lamarseillaise.cm']);
    console.log('Users:', user.rows);
    const schools = await client.query('select id, slug, name from school_app.schools');
    console.log('Schools:', schools.rows);
    const members = await client.query('select * from school_app.school_members');
    console.log('School members:', members.rows);
    for (const u of user.rows) {
      await client.query('begin');
      await client.query("select set_config('app.current_user_id', $1, true)", [u.id]);
      await client.query("select set_config('app.school_id', $1, true)", [schools.rows[0].id]);
      const r = await client.query('select school_app.member_role() as role');
      console.log('User', u.email, 'member_role():', r.rows[0]);
      await client.query('rollback');
    }
  } finally {
    client.release();
    await pool.end();
  }
}
check().catch(console.error);
