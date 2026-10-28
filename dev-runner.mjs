import { spawn } from 'child_process';
import path from 'path';

// Translate --host (passed by container runner) to -H for Next.js CLI compatibility
const nextBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'next');

const child = spawn(nextBin, ['dev', '-p', '3000', '-H', '0.0.0.0'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '3000' },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
