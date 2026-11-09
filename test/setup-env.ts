import { config } from 'dotenv';

// Unit and integration tests must not depend on a developer or CI .env file.
// Load the non-secret example values before application modules validate env at import time.
config({ path: '.env.example', quiet: true });

process.env.ACCESS_TOKEN_SECRET ||= 'test-access-token-secret';
process.env.REFRESH_TOKEN_SECRET ||= 'test-refresh-token-secret';
