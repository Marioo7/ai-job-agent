// pm2 process file. Adjust the path if you install somewhere other than /opt/ai-job-agent.
// Each app runs with its own folder as cwd so it finds ../.env (the shared .env in the project root).
const root = '/opt/ai-job-agent';
const common = { env: { NODE_ENV: 'production' }, max_restarts: 50, restart_delay: 5000, time: true };

module.exports = {
  apps: [
    { name: 'job-backend', cwd: `${root}/backend`, script: 'dist/index.js', ...common },
    { name: 'job-worker', cwd: `${root}/worker`, script: 'dist/index.js', ...common },
  ],
};
