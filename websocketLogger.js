import { WebSocketServer } from 'ws';

// This map will store WebSocket clients keyed by their unique requestId.
const clientMap = new Map();

let wss;

export function setupWebSocketServer(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected, waiting for subscription.');

    // When a client sends a message, we expect it to be a subscription request.
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'subscribe' && data.requestId) {
          const { requestId } = data;
          // Associate this websocket connection with the requestId
          ws.requestId = requestId;
          clientMap.set(requestId, ws);
          console.log(`Client subscribed with requestId: ${requestId}`);
          ws.send(JSON.stringify({ type: 'info', message: `Subscribed successfully to logs for request: ${requestId}` }));
        }
      } catch (e) {
        console.error('Failed to handle message:', e);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    ws.on('close', () => {
      // When a client disconnects, remove them from the map to clean up.
      if (ws.requestId) {
        clientMap.delete(ws.requestId);
        console.log(`Client for requestId ${ws.requestId} disconnected and was removed.`);
      } else {
        console.log('A client disconnected without subscribing.');
      }
    });
  });

  console.log('WebSocket server is set up for request-specific logging.');
}

// Log levels can be 'info', 'success', 'error', 'warning', or 'detail'
const logPrefix = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    detail: '    ' // Indent for detailed steps
};

/**
 * Sends a log message to the correct client based on the request ID.
 * The message is formatted into a readable string.
 *
 * @param {string} requestId - The unique identifier for the request/client.
 * @param {string} message - The log message content.
 * @param {'info'|'success'|'error'|'warning'|'detail'} [level='info'] - The log level, which determines the icon.
 */
export function log(requestId, data) {
  const client = clientMap.get(requestId);

  if (client && client.readyState === client.OPEN) {
    const payload = typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { type: 'log', timestamp: new Date().toISOString(), ...data }
      : { type: 'log', timestamp: new Date().toISOString(), message: data };

    const logMessageForConsole = typeof payload.message === 'string' ? payload.message : JSON.stringify(data);
    console.log(`[${requestId}] ${logMessageForConsole}`); // Log to console as well
    
    client.send(JSON.stringify(payload));
  }
} 