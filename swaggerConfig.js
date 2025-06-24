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
      url: `http://localhost:${process.env.PORT || 3000}`,
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      SessionID: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Session-ID',
        description: 'Session ID obtained after successful authentication via the /auth/callback endpoint. Include this in the header of requests to protected endpoints.'
      }
    }
  },
  tags: [
    {
      name: 'Authentication',
      description: 'Handles OAuth 2.0 flow with LinkedIn.',
    },
    {
      name: 'Posts',
      description: 'API for creating, reading, and deleting LinkedIn posts.',
    },
    {
      name: 'Comments',
      description: 'API for managing comments on LinkedIn posts.',
    },
    {
      name: 'WordPress',
      description: 'API for posting to WordPress sites.',
    },
    {
      name: 'Reddit',
      description: 'API for posting to Reddit.',
    },
    {
      name: 'Delphi Forums',
      description: 'API for posting to Delphi Forums.',
    },
    {
      name: 'City-Data Forums',
      description: 'API for posting to City-Data Forums.',
    },
    {
      name: 'Simple Machines Forums',
      description: 'API for posting to Simple Machines Forums.',
    },
    {
      name: 'Gentoo Forums',
      description: 'API for posting to Gentoo Forums.',
    },
    {
      name: 'Bloglovin',
      description: 'API for posting to Bloglovin.',
    }
  ]
};

const options = {
  swaggerDefinition,
  // Paths to files containing OpenAPI definitions
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec; 