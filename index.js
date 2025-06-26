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

dotenv.config();
loadSessions(); // Load sessions from file on startup

const app = express();
const server = createServer(app); // Create an HTTP server
const PORT = process.env.PORT || 3000;

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


// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
