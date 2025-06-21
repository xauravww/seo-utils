import fs from 'fs';
import path from 'path';

const sessionsFilePath = path.join(process.cwd(), 'sessions.json');

let userSessions = {};

const loadSessions = () => {
  try {
    if (fs.existsSync(sessionsFilePath)) {
      const data = fs.readFileSync(sessionsFilePath, 'utf8');
      userSessions = JSON.parse(data);
      console.log('INFO: User sessions loaded from sessions.json');
    } else {
      console.log('INFO: No sessions.json file found, starting with empty sessions.');
    }
  } catch (error) {
    console.error('ERROR: Could not load sessions.json. Starting with empty sessions.', error);
    userSessions = {};
  }
};

const saveSessions = () => {
  try {
    fs.writeFileSync(sessionsFilePath, JSON.stringify(userSessions, null, 2), 'utf8');
  } catch (error) {
    console.error('ERROR: Could not save sessions to sessions.json.', error);
  }
};

const getSession = (sessionId) => {
  return userSessions[sessionId];
};

const setSession = (sessionId, sessionData) => {
  userSessions[sessionId] = sessionData;
  saveSessions();
};

export { loadSessions, getSession, setSession }; 