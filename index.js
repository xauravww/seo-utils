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
import { publishQueue } from './controllers/publishController.js';
import { QueueEvents } from 'bullmq';
import os from 'os';
import { exec } from 'child_process';

dotenv.config();
loadSessions(); // Load sessions from file on startup

const app = express();
const server = createServer(app); // Create an HTTP server
const PORT = process.env.PORT || 3000;

// Setup Bull Board dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(publishQueue)],
  serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());

// Setup WebSocket server
setupWebSocketServer(server);

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

// Enhanced health-check endpoint for BullMQ worker and system stats
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
    const waiting = await publishQueue.getWaitingCount();
    const active = await publishQueue.getActiveCount();
    const completed = await publishQueue.getCompletedCount();
    const failed = await publishQueue.getFailedCount();
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
                <tr><td>publishQueue</td><td>${waiting}</td><td>${active}</td><td>${completed}</td><td>${failed}</td></tr>
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
          queue: { waiting, active, completed, failed },
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

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  console.log(`BullMQ dashboard is available at http://localhost:${PORT}/admin/queues`)
});
