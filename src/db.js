const { Pool } = require('pg');

// Dynamic SSL: only enable if DATABASE_URL contains sslmode=require (e.g. Neon)
const dbUrl = process.env.DATABASE_URL || '';
const needsSSL = dbUrl.includes('sslmode=require') || dbUrl.includes('ssl=true');

const pool = new Pool({
  connectionString: dbUrl,
  ...(needsSSL ? { ssl: { rejectUnauthorized: false } } : {})
});

pool.on('error', (err) => {
  console.error('DB pool error:', err.message);
});

// ============================================================
// FILTERS
// ============================================================

async function getFilter(name) {
  try {
    const res = await pool.query('SELECT * FROM filters WHERE name = $1', [name.toLowerCase()]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('DB getFilter error:', err.message);
    return null;
  }
}

async function getAllFilters() {
  try {
    const res = await pool.query('SELECT * FROM filters ORDER BY name ASC');
    return res.rows;
  } catch (err) {
    console.error('DB getAllFilters error:', err.message);
    return [];
  }
}

async function getFilterNames() {
  try {
    const res = await pool.query('SELECT name FROM filters ORDER BY name ASC');
    return res.rows.map(r => r.name);
  } catch (err) {
    console.error('DB getFilterNames error:', err.message);
    return [];
  }
}

async function getFilterCount() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM filters');
    return parseInt(res.rows[0].count);
  } catch (err) {
    console.error('DB getFilterCount error:', err.message);
    return 0;
  }
}

async function upsertFilter(data) {
  try {
    const {
      name, text, photo, video, document: doc,
      animation, audio, voice, sticker,
      entities, caption_entities, buttons, created_by
    } = data;

    await pool.query(
      `INSERT INTO filters
         (name, text, photo, video, document, animation, audio, voice, sticker,
          entities, caption_entities, buttons, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (name) DO UPDATE SET
         text             = EXCLUDED.text,
         photo            = EXCLUDED.photo,
         video            = EXCLUDED.video,
         document         = EXCLUDED.document,
         animation        = EXCLUDED.animation,
         audio            = EXCLUDED.audio,
         voice            = EXCLUDED.voice,
         sticker          = EXCLUDED.sticker,
         entities         = EXCLUDED.entities,
         caption_entities = EXCLUDED.caption_entities,
         buttons          = EXCLUDED.buttons`,
      [
        name.toLowerCase(), text || null,
        photo || null, video || null, doc || null,
        animation || null, audio || null, voice || null, sticker || null,
        entities         ? JSON.stringify(entities)         : null,
        caption_entities ? JSON.stringify(caption_entities) : null,
        buttons          ? JSON.stringify(buttons)          : null,
        created_by
      ]
    );
  } catch (err) {
    console.error('DB upsertFilter error:', err.message);
    throw err;
  }
}

async function deleteFilter(name) {
  try {
    await pool.query('DELETE FROM filters WHERE name = $1', [name.toLowerCase()]);
  } catch (err) {
    console.error('DB deleteFilter error:', err.message);
    throw err;
  }
}

async function filterExists(name) {
  try {
    const res = await pool.query('SELECT 1 FROM filters WHERE name = $1', [name.toLowerCase()]);
    return res.rows.length > 0;
  } catch (err) {
    console.error('DB filterExists error:', err.message);
    return false;
  }
}

async function cloneFilter(sourceName, targetName) {
  try {
    await pool.query(
      `INSERT INTO filters
         (name, text, photo, video, document, animation, audio, voice, sticker,
          entities, caption_entities, buttons, created_by)
       SELECT $2, text, photo, video, document, animation, audio, voice, sticker,
              entities, caption_entities, buttons, created_by
       FROM filters WHERE name = $1`,
      [sourceName.toLowerCase(), targetName.toLowerCase()]
    );
  } catch (err) {
    console.error('DB cloneFilter error:', err.message);
    throw err;
  }
}

async function renameFilter(oldName, newName) {
  try {
    await pool.query(
      'UPDATE filters SET name = $2 WHERE name = $1',
      [oldName.toLowerCase(), newName.toLowerCase()]
    );
  } catch (err) {
    console.error('DB renameFilter error:', err.message);
    throw err;
  }
}

async function searchFilters(term) {
  try {
    const res = await pool.query(
      'SELECT name FROM filters WHERE name ILIKE $1 ORDER BY name',
      [`%${term.toLowerCase()}%`]
    );
    return res.rows.map(r => r.name);
  } catch (err) {
    console.error('DB searchFilters error:', err.message);
    return [];
  }
}

async function getFilterStats() {
  try {
    const res = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE photo     IS NOT NULL) AS photo,
        COUNT(*) FILTER (WHERE video     IS NOT NULL) AS video,
        COUNT(*) FILTER (WHERE document  IS NOT NULL) AS document,
        COUNT(*) FILTER (WHERE animation IS NOT NULL) AS animation,
        COUNT(*) FILTER (WHERE audio     IS NOT NULL) AS audio,
        COUNT(*) FILTER (WHERE voice     IS NOT NULL) AS voice,
        COUNT(*) FILTER (WHERE sticker   IS NOT NULL) AS sticker,
        COUNT(*) FILTER (WHERE photo IS NULL AND video IS NULL AND document IS NULL
                           AND animation IS NULL AND audio IS NULL AND voice IS NULL
                           AND sticker IS NULL AND text IS NOT NULL) AS text,
        COUNT(*) AS total,
        MIN(created_at) AS oldest_date,
        (SELECT name FROM filters ORDER BY created_at ASC LIMIT 1) AS oldest_name
      FROM filters
    `);
    return res.rows[0];
  } catch (err) {
    console.error('DB getFilterStats error:', err.message);
    return { total: 0, photo: 0, video: 0, document: 0, animation: 0, audio: 0, voice: 0, sticker: 0, text: 0 };
  }
}

// ============================================================
// USER ANALYTICS
// ============================================================

async function trackUserAccess(userId, username, firstName, lastName) {
  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO user_analytics (user_id, username, first_name, last_name, first_seen, last_seen, attempt_count)
       VALUES ($1,$2,$3,$4,$5,$5,1)
       ON CONFLICT (user_id) DO UPDATE SET
         username      = COALESCE($2, user_analytics.username),
         first_name    = COALESCE($3, user_analytics.first_name),
         last_name     = COALESCE($4, user_analytics.last_name),
         last_seen     = $5,
         attempt_count = user_analytics.attempt_count + 1`,
      [userId, username || null, firstName || null, lastName || null, now]
    );
  } catch (err) {
    console.error('DB trackUserAccess error:', err.message);
  }
}

async function getAllAnalytics() {
  try {
    const res = await pool.query('SELECT * FROM user_analytics ORDER BY last_seen DESC');
    return res.rows;
  } catch (err) {
    console.error('DB getAllAnalytics error:', err.message);
    return [];
  }
}

async function getAnalyticsCount() {
  try {
    const res = await pool.query('SELECT COUNT(*) FROM user_analytics');
    return parseInt(res.rows[0].count);
  } catch (err) {
    console.error('DB getAnalyticsCount error:', err.message);
    return 0;
  }
}

async function setSpamTimeout(userId, untilTs, reason = 'spam') {
  try {
    await pool.query(
      `INSERT INTO spam_timeouts (user_id, until_ts, reason)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET until_ts=$2, reason=$3`,
      [userId, untilTs, reason]
    );
  } catch (err) {
    console.error('DB setSpamTimeout error:', err.message);
    throw err;
  }
}

async function getSpamTimeout(userId) {
  try {
    const res = await pool.query('SELECT * FROM spam_timeouts WHERE user_id = $1', [userId]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('DB getSpamTimeout error:', err.message);
    return null;
  }
}

async function clearSpamTimeout(userId) {
  try {
    await pool.query('DELETE FROM spam_timeouts WHERE user_id = $1', [userId]);
  } catch (err) {
    console.error('DB clearSpamTimeout error:', err.message);
  }
}

async function cleanExpiredTimeouts() {
  try {
    await pool.query('DELETE FROM spam_timeouts WHERE until_ts < $1', [Date.now()]);
  } catch (err) {
    console.error('DB cleanExpiredTimeouts error:', err.message);
  }
}

module.exports = {
  pool,
  getFilter, getAllFilters, getFilterNames, getFilterCount,
  upsertFilter, deleteFilter, filterExists, cloneFilter, renameFilter,
  searchFilters, getFilterStats,
  trackUserAccess, getAllAnalytics, getAnalyticsCount,
  setSpamTimeout, getSpamTimeout, clearSpamTimeout, cleanExpiredTimeouts
};
