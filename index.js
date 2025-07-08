import express from 'express';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { setupWebSocketServer } from './websocketLogger.js';
import linkedinRoutes from './routes/linkedinRoutes.js';
import publishRoutes from './routes/publishRoutes.js';
import wpPostRoutes from './routes/wpPostRoutes.js';
import redditRoutes from './routes/redditRoutes.js';
import delphiRoutes from './routes/delphiRoutes.js';
import cityDataRoutes from './routes/cityDataRoutes.js';
import simpleMachinesRoutes from './routes/simpleMachinesRoutes.js';
import gentooRoutes from './routes/gentooRoutes.js';
import { loadSessions } from './sessionStore.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swaggerConfig.js';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { queues, categories } from './controllers/publishController.js';
import { QueueEvents } from 'bullmq';
import os from 'os';
import { exec } from 'child_process';
import * as websocketLogger from './websocketLogger.js';
import { Job } from 'bullmq';

dotenv.config();
loadSessions(); // Load sessions from file on startup

const app = express();
const server = createServer(app); // Create an HTTP server
const PORT = process.env.PORT || 3000;

// Setup Bull Board dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: categories.map(cat => new BullMQAdapter(queues[cat])),
  serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());

// Setup WebSocket server
setupWebSocketServer(server);

// Setup BullMQ QueueEvents listeners to forward logs to websocketLogger
for (const cat of categories) {
  const queueName = `${cat}Queue`;
  const queueEvents = new QueueEvents(queueName, { connection: queues[cat].client });

  // Helper to get requestId from jobId
  async function getRequestIdForJob(jobId) {
    try {
      const job = await queues[cat].getJob(jobId);
      return job?.data?.requestId;
    } catch (e) {
      return undefined;
    }
  }

  queueEvents.on('completed', async ({ jobId, returnvalue }) => {
    const requestId = await getRequestIdForJob(jobId);
    if (requestId) {
      websocketLogger.log(requestId, `[BullMQ] Job ${jobId} completed: ${JSON.stringify(returnvalue)}`, 'success');
    }
  });

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    const requestId = await getRequestIdForJob(jobId);
    if (requestId) {
      websocketLogger.log(requestId, `[BullMQ] Job ${jobId} failed: ${failedReason}`, 'error');
    }
  });

  queueEvents.on('log', async ({ jobId, data }) => {
    const requestId = await getRequestIdForJob(jobId);
    if (requestId) {
      websocketLogger.log(requestId, data);
    }
  });
}

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.use((req, res, next) => {
    const start = process.hrtime();
    const originalJson = res.json;

    res.json = (data) => {
        const diff = process.hrtime(start);
        const duration = (diff[0] + diff[1] / 1e9).toFixed(3);
        data.responseTime_seconds = parseFloat(duration);
        originalJson.call(res, data);
    };

    next();
});

app.use(express.json());

// Add the new publish route
app.use('/api/publish', publishRoutes);

// Modular and specific route mounting
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/bloglovin', publishRoutes);
app.use('/api/wordpress', wpPostRoutes);
app.use('/api/reddit', redditRoutes);
app.use('/api/delphi', delphiRoutes);
app.use('/api/city-data', cityDataRoutes);
app.use('/api/simple-machines', simpleMachinesRoutes);
app.use('/api', gentooRoutes);

/**
 * @swagger
 * /admin/queues/worker-health:
 *   get:
 *     summary: Get BullMQ worker and system health
 *     tags: [BullMQ]
 *     description: |
 *       Returns stats for all BullMQ queues (waiting, active, completed, failed) and system stats (RAM, CPU, disk, uptime).
 *       If Accept: text/html, returns a live HTML dashboard.
 *     responses:
 *       200:
 *         description: Health info (JSON or HTML)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'ok' }
 *                 queues:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       waiting: { type: integer, example: 0 }
 *                       active: { type: integer, example: 0 }
 *                       completed: { type: integer, example: 0 }
 *                       failed: { type: integer, example: 0 }
 *                 system: { type: object }
 *                 disk: { type: array }
 *           text/html:
 *             schema:
 *               type: string
 *               example: '<html>...dashboard...</html>'
 */
app.get('/admin/queues/worker-health', async (req, res) => {
  // Helper to get disk space (cross-platform)
  function getDiskSpace(callback) {
    if (process.platform === 'win32') {
      exec('wmic logicaldisk get size,freespace,caption', (err, stdout) => {
        if (err) return callback(null);
        const lines = stdout.trim().split('\n');
        const disks = lines.slice(1).map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length === 3) {
            return {
              drive: parts[0],
              free: Number(parts[1]),
              size: Number(parts[2])
            };
          }
          return null;
        }).filter(Boolean);
        callback(disks);
      });
    } else {
      exec('df -k --output=avail,size,target', (err, stdout) => {
        if (err) return callback(null);
        const lines = stdout.trim().split('\n');
        const disks = lines.slice(1).map(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length === 3) {
            return {
              mount: parts[2],
              free: Number(parts[0]) * 1024,
              size: Number(parts[1]) * 1024
            };
          }
          return null;
        }).filter(Boolean);
        callback(disks);
      });
    }
  }

  try {
    // Gather stats for all queues
    const queueStats = {};
    for (const cat of categories) {
      const q = queues[cat];
      queueStats[cat] = {
        waiting: await q.getWaitingCount(),
        active: await q.getActiveCount(),
        completed: await q.getCompletedCount(),
        failed: await q.getFailedCount(),
      };
    }
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const loadAvg = os.loadavg ? os.loadavg() : [];
    const uptime = os.uptime();
    getDiskSpace((diskStats) => {
      // If HTML requested, serve a live UI
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        res.send(`
          <html>
            <head>
              <title>Worker & System Health</title>
              <meta http-equiv="refresh" content="5">
              <style>
                body { font-family: Arial, sans-serif; background: #f9f9f9; color: #222; }
                h2 { color: #007bff; }
                table { border-collapse: collapse; margin: 1em 0; }
                th, td { border: 1px solid #ccc; padding: 0.5em 1em; }
                th { background: #eee; }
              </style>
            </head>
            <body>
              <h2>BullMQ Worker & System Health</h2>
              <table>
                <tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Completed</th><th>Failed</th></tr>
                ${Object.entries(queueStats).map(([cat, stats]) => `<tr><td>${cat}Queue</td><td>${stats.waiting}</td><td>${stats.active}</td><td>${stats.completed}</td><td>${stats.failed}</td></tr>`).join('')}
              </table>
              <table>
                <tr><th>System</th><th>Value</th></tr>
                <tr><td>Total RAM</td><td>${(totalMem/1024/1024/1024).toFixed(2)} GB</td></tr>
                <tr><td>Free RAM</td><td>${(freeMem/1024/1024/1024).toFixed(2)} GB</td></tr>
                <tr><td>Used RAM</td><td>${(usedMem/1024/1024/1024).toFixed(2)} GB</td></tr>
                <tr><td>CPU Load (1/5/15m)</td><td>${loadAvg.map(x=>x.toFixed(2)).join(' / ')}</td></tr>
                <tr><td>Uptime</td><td>${(uptime/60/60).toFixed(2)} hours</td></tr>
              </table>
              <table>
                <tr><th>Disk</th><th>Free</th><th>Total</th></tr>
                ${(diskStats||[]).map(d => `<tr><td>${d.drive||d.mount}</td><td>${(d.free/1024/1024/1024).toFixed(2)} GB</td><td>${(d.size/1024/1024/1024).toFixed(2)} GB</td></tr>`).join('')}
              </table>
              <p style="color:#888;">Auto-refreshes every 5 seconds.</p>
            </body>
          </html>
        `);
      } else {
        res.json({
          status: 'ok',
          queues: queueStats,
          system: {
            totalMem, freeMem, usedMem, loadAvg, uptime
          },
          disk: diskStats
        });
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * @swagger
 * /admin/queues/remove-active:
 *   post:
 *     summary: Forcibly remove an active BullMQ job
 *     tags: [BullMQ]
 *     description: |
 *       Moves an active job to failed and removes it from the queue. Use with caution.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [queueName, jobId]
 *             properties:
 *               queueName: { type: string, example: 'pingQueue' }
 *               jobId: { type: string, example: '123' }
 *     responses:
 *       200:
 *         description: Job removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: 'removed' }
 *                 jobId: { type: string, example: '123' }
 *       400:
 *         description: Missing parameters
 *       404:
 *         description: Queue or job not found
 *       500:
 *         description: Server error
 */
app.post('/admin/queues/remove-active', async (req, res) => {
  const { queueName, jobId } = req.body;
  if (!queueName || !jobId) {
    return res.status(400).json({ error: 'queueName and jobId are required' });
  }
  const queue = queues[queueName.replace('Queue', '')];
  if (!queue) {
    return res.status(404).json({ error: 'Queue not found' });
  }
  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    await job.moveToFailed(new Error('Manually removed by admin'), true);
    await job.remove();
    res.json({ status: 'removed', jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /admin/queues/remove-active-ui:
 *   get:
 *     summary: HTML UI to remove active BullMQ jobs
 *     tags: [BullMQ]
 *     description: |
 *       Simple admin page with a form to remove active jobs by queue and job ID.
 *     responses:
 *       200:
 *         description: HTML form
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: '<html>...form...</html>'
 */
app.get('/admin/queues/remove-active-ui', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Remove Active Job</title>
        <style>
          body { font-family: Arial; margin: 2em; }
          input, select { margin: 0.5em; }
        </style>
      </head>
      <body>
        <h2>Remove Active Job</h2>
        <form id="removeForm">
          <label>Queue Name:
            <select name="queueName">
              ${Object.keys(queues).map(q => `<option value="${q}Queue">${q}Queue</option>`).join('')}
            </select>
          </label>
          <label>Job ID: <input name="jobId" required /></label>
          <button type="submit">Remove Active Job</button>
        </form>
        <div id="result"></div>
        <script>
          document.getElementById('removeForm').onsubmit = async function(e) {
            e.preventDefault();
            const form = e.target;
            const queueName = form.queueName.value;
            const jobId = form.jobId.value;
            const res = await fetch('/admin/queues/remove-active', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ queueName, jobId })
            });
            const data = await res.json();
            document.getElementById('result').innerText = JSON.stringify(data, null, 2);
          };
        </script>
      </body>
    </html>
  `);
});

// API route to get all active jobs and their requestIds
app.get('/api/active-jobs', async (req, res) => {
  try {
    const activeJobs = [];
    for (const cat of categories) {
      const jobs = await queues[cat].getActive();
      for (const job of jobs) {
        if (job.data && job.data.requestId) {
          activeJobs.push({
            jobId: job.id,
            requestId: job.data.requestId,
            category: cat
          });
        }
      }
    }
    res.json(activeJobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  console.log(`BullMQ dashboard is available at http://localhost:${PORT}/admin/queues`)
});
