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

// The log function now takes a requestId to send the message to the correct client.
export function log(requestId, message) {
  const client = clientMap.get(requestId);
  if (client && client.readyState === client.OPEN) {
    const formattedMessage = JSON.stringify({ type: 'log', message, timestamp: new Date().toISOString() });
    client.send(formattedMessage);
  }
} 