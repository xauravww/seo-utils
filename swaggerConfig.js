import swaggerJSDoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'LinkedIn Post API',
    version: '1.0.0',
    description:
      'This is a REST API application made with Express. It retrieves data from the LinkedIn API to allow creating, reading, and deleting posts and comments.',
    contact: {
      name: 'Your Name',
      email: 'your.email@example.com',
    },
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3000}/api`,
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      sessionId: {
        type: 'apiKey',
        in: 'body',
        name: 'sessionId',
        description: 'Session ID obtained after successful authentication. Include this in the body of requests to protected endpoints.'
      }
    }
  },
  security: [{
    sessionId: []
  }]
};

const options = {
  swaggerDefinition,
  // Paths to files containing OpenAPI definitions
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec; 