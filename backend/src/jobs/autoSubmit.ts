/**
 * Auto-submit job: every 5 seconds, submits attempts whose server deadline has passed,
 * using the answers saved so far. (Attempts are also closed lazily whenever the student
 * or a late answer reaches the server, so the job is a safety net, not the only path.)
 */
import { sweepExpiredAttempts } from '../services/attempt.service';

export const AUTO_SUBMIT_INTERVAL_MS = 5000;

export function startAutoSubmitJob(): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const n = await sweepExpiredAttempts();
      if (n > 0) console.log(`Auto-submitted ${n} attempt(s) at the deadline`);
    } catch (err) {
      console.error('Auto-submit job failed', err);
    } finally {
      running = false;
    }
  }, AUTO_SUBMIT_INTERVAL_MS);
}
