# LinkedIn Post API

This is a REST API application built with Express.js that allows you to authenticate with LinkedIn, and then create, read, and delete posts and comments on behalf of a user. It features a basic session management system and provides interactive API documentation through Swagger.

## Features

- OAuth 2.0 authentication with LinkedIn
- CRUD operations for LinkedIn posts
- CRUD operations for comments on posts
- In-memory session management for authenticated users
- Detailed API documentation with Swagger

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or later recommended)
- A LinkedIn account
- A LinkedIn Developer Application with the `openid`, `profile`, and `w_member_social` permissions.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <your-project-directory>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file:**
    Create a file named `.env` in the root of the project and add your LinkedIn application credentials:

    ```env
    LINKEDIN_CLIENT_ID='YOUR_LINKEDIN_CLIENT_ID'
    LINKEDIN_CLIENT_SECRET='YOUR_LINKEDIN_CLIENT_SECRET'
    REDIRECT_URI='http://localhost:3001/auth/callback'
    PORT=3001
    ```
    
    **Note:** Ensure the `REDIRECT_URI` matches the one configured in your LinkedIn Developer App settings.

## Running the Application

To start the server, run the following command:

```bash
npm start
```
*If you do not have a `start` script, run `node index.js` instead.*

The server will start on `http://localhost:3001`.

## API Usage

### API Documentation

Interactive API documentation is available via Swagger UI. Once the server is running, navigate to:

**[http://localhost:3001/api-docs](http://localhost:3001/api-docs)**

### Authentication Flow

1.  **Start Authentication:** Open your browser and go to `http://localhost:3001/auth`.
2.  **Grant Permissions:** You will be redirected to LinkedIn to log in and approve the permissions for your application.
3.  **Receive Session ID:** After approval, you will be redirected back to the `/auth/callback` endpoint, which will return a JSON response containing your unique `sessionId`.

    ```json
    {
      "message": "Authentication successful. Use the sessionId to make API calls.",
      "sessionId": "a1b2c3d4",
      "userUrn": "urn:li:person:abcdef123"
    }
    ```

### Making API Calls

To use the protected endpoints (for posts and comments), you must include the `sessionId` you received in the body of your JSON request. See the examples in the `/api-docs` for detailed instructions on how to structure your requests. 