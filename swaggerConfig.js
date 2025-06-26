import swaggerJSDoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Unified Content Publishing API',
    version: '1.1.0',
    description:
      'A REST API application for publishing content to multiple types of websites, including blogs, forums, and social media platforms, using a unified endpoint.',
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
      name: 'Publishing',
      description: 'The unified endpoint for submitting content to multiple sites.',
    },
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