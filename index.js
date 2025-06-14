import express from 'express';
import postRoutes from './routes/postRoutes.js'; // Import the new routes

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Use the post routes
app.use('/', postRoutes); // Mount the router, all routes defined in postRoutes will be relative to '/'

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
