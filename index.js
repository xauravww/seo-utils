import express from 'express';
import dotenv from 'dotenv';
import linkedinRoutes from './routes/linkedinRoutes.js';
import publishRoutes from './routes/publishRoutes.js';
import wpPostRoutes from './routes/wpPostRoutes.js';
import redditRoutes from './routes/redditRoutes.js';
import delphiRoutes from './routes/delphiRoutes.js';
import { loadSessions } from './sessionStore.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swaggerConfig.js';

dotenv.config();
loadSessions(); // Load sessions from file on startup

const app = express();
const PORT = process.env.PORT || 3000;

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

// Modular and specific route mounting
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/bloglovin', publishRoutes);
app.use('/api/wordpress', wpPostRoutes);
app.use('/api/reddit', redditRoutes);
app.use('/api/delphi', delphiRoutes);


// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
