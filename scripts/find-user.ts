import * as dotenv from 'dotenv';
dotenv.config();
import { db } from '../lib/db';
import { users } from '../lib/schema';
import { eq } from 'drizzle-orm';

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('Please provide an email.');
    process.exit(1);
  }
  const result = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (result) {
    console.log(`User ID: ${result.id}`);
  } else {
    console.log('User not found.');
  }
  process.exit(0);
}

run();
