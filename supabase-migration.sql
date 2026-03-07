-- Migration: Add quote editing, tracking, and partner portal tables
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- ============================================================
-- 1. QUOTE EDITING COLUMNS (on existing orders table)
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_token TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_config TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_orders_edit_token ON orders (edit_token) WHERE edit_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_email_type ON orders (customer_email, order_type);

-- ============================================================
-- 2. PARTNER PORTAL TABLES
-- ============================================================

-- Partners (funeral directors)
CREATE TABLE IF NOT EXISTS partners (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link orders to partners
ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(id);
CREATE INDEX IF NOT EXISTS idx_orders_partner ON orders (partner_id) WHERE partner_id IS NOT NULL;

-- Partner comments on orders
CREATE TABLE IF NOT EXISTS partner_comments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_comments_order ON partner_comments (order_id);

-- Partner sessions (for auth)
CREATE TABLE IF NOT EXISTS partner_sessions (
    id SERIAL PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_sessions_token ON partner_sessions (token);

-- ============================================================
-- 3. PARTNER REQUEST STATUS (for self-service registration)
-- ============================================================

ALTER TABLE partners ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
-- Existing partners default to 'approved'. New requests will be 'pending'.
-- Values: 'pending', 'approved', 'declined'

ALTER TABLE partners ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- 4. ADMIN SESSIONS (separate from partner sessions)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_sessions (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions (token);
