import express from 'express';
import dotenv from 'dotenv';
import linkedinRoutes from './routes/linkedinRoutes.js';
import publishRoutes from './routes/publishRoutes.js';
import postRoutes from './routes/postRoutes.js';
import { loadSessions } from './sessionStore.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swaggerConfig.js';

dotenv.config();
loadSessions(); // Load sessions from file on startup

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// All API routes are now in linkedinRoutes
app.use('/api', linkedinRoutes);
app.use('/api', publishRoutes);
app.use('/api', postRoutes);


// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
