-- Bot Hoki — Database Schema
-- Jalankan sekali saat setup awal: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS filters (
  name             VARCHAR(50)  PRIMARY KEY,
  text             TEXT,
  photo            TEXT,
  video            TEXT,
  document         TEXT,
  animation        TEXT,
  audio            TEXT,
  voice            TEXT,
  sticker          TEXT,
  entities         JSONB,
  caption_entities JSONB,
  buttons          JSONB,
  created_by       BIGINT       NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_analytics (
  user_id       BIGINT  PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  first_seen    BIGINT  NOT NULL,
  last_seen     BIGINT  NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS spam_timeouts (
  user_id  BIGINT  PRIMARY KEY,
  until_ts BIGINT  NOT NULL,
  reason   TEXT    NOT NULL DEFAULT 'spam'
);
