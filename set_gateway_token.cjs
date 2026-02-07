const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');

const token = crypto.randomBytes(32).toString('hex');
console.log('========================================');
console.log('GATEWAY_TOKEN (このトークンを必ずメモしてください！):');
console.log(token);
console.log('========================================');

// Write to temp file and use it
fs.writeFileSync('temp_token.txt', token);
execSync('cmd /c "type temp_token.txt | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN"', { stdio: 'inherit' });
fs.unlinkSync('temp_token.txt');
