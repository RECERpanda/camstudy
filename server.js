import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Load Firebase Config
let firebaseConfig = {};
let db = null;

try {
  const configPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!getApps().length) {
      const adminApp = initializeApp({
        projectId: firebaseConfig.projectId
      });
      db = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || '(default)');
      console.log('🔥 Firebase Admin Firestore connected successfully');
    }
  }
} catch (err) {
  console.warn('Firebase initialization notice:', err.message);
}

// In-memory fallback study_records store
let studyRecords = [];

// Helper to calculate current study day key (4 AM boundary)
function getStudyDay(date = new Date()) {
  const d = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Cleanup offline users (> 45s without heartbeat)
setInterval(() => {
  const now = Date.now();
  studyRecords.forEach(record => {
    if (record.is_online && (now - record.last_seen > 45000)) {
      record.is_online = false;
    }
  });
}, 10000);

// Endpoint to fetch client firebase config
app.get('/api/firebase-config', (req, res) => {
  res.json(firebaseConfig);
});

// API Endpoints for Genspark RESTful Table API compliance (`tables/study_records`)

// GET /tables/study_records
app.get('/tables/study_records', async (req, res) => {
  const today = getStudyDay();
  const studyDayQuery = req.query.study_day || today;

  if (db) {
    try {
      const snapshot = await db.collection('study_records')
        .where('study_day', '==', studyDayQuery)
        .get();

      const firestoreData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.json({ data: firestoreData, records: firestoreData });
    } catch (e) {
      console.warn('Firestore fetch fallback:', e.message);
    }
  }

  const filtered = studyRecords.filter(r => r.study_day === studyDayQuery);
  res.json({ data: filtered, records: filtered });
});

// POST /tables/study_records
app.post('/tables/study_records', async (req, res) => {
  const { nickname, total_seconds = 0, study_day = getStudyDay(), avatar = '🌱', is_online = true } = req.body;

  if (!nickname) {
    return res.status(400).json({ error: 'Nickname is required' });
  }

  let record = studyRecords.find(r => r.nickname === nickname && r.study_day === study_day);

  if (record) {
    record.is_online = true;
    record.last_seen = Date.now();
    if (avatar) record.avatar = avatar;
  } else {
    record = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      nickname,
      total_seconds: Number(total_seconds) || 0,
      study_day,
      is_online: Boolean(is_online),
      last_seen: Date.now(),
      avatar: avatar || '🌱'
    };
    studyRecords.push(record);
  }

  if (db) {
    try {
      const docRef = db.collection('study_records').doc(record.id);
      await docRef.set(record, { merge: true });
    } catch (e) {
      console.warn('Firestore save fallback:', e.message);
    }
  }

  res.json({ data: record, record });
});

// PATCH /tables/study_records/:id or PATCH /tables/study_records
app.patch('/tables/study_records/:id?', async (req, res) => {
  const id = req.params.id || req.body.id;
  const { nickname, study_day, total_seconds, is_online, last_seen, avatar } = req.body;

  let record = null;
  if (id) {
    record = studyRecords.find(r => r.id === id);
  } else if (nickname) {
    const today = study_day || getStudyDay();
    record = studyRecords.find(r => r.nickname === nickname && r.study_day === today);
  }

  if (!record) {
    // Create new if missing
    record = {
      id: id || `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      nickname: nickname || '익명',
      total_seconds: typeof total_seconds === 'number' ? total_seconds : 0,
      study_day: study_day || getStudyDay(),
      is_online: typeof is_online === 'boolean' ? is_online : true,
      last_seen: last_seen || Date.now(),
      avatar: avatar || '🌱'
    };
    studyRecords.push(record);
  } else {
    if (typeof total_seconds === 'number') record.total_seconds = total_seconds;
    if (typeof is_online === 'boolean') record.is_online = is_online;
    if (avatar) record.avatar = avatar;
    record.last_seen = last_seen || Date.now();
  }

  if (db) {
    try {
      const docRef = db.collection('study_records').doc(record.id);
      await docRef.set(record, { merge: true });
    } catch (e) {
      console.warn('Firestore patch fallback:', e.message);
    }
  }

  res.json({ data: record, record });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    firebaseConnected: !!db,
    serverTime: new Date().toISOString()
  });
});

// Serve static frontend files
app.use(express.static(__dirname));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`☀️ Camstudy server running at http://0.0.0.0:${PORT}`);
});

