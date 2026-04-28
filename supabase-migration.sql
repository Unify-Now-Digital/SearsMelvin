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

-- Permit fee (separate from product value)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS permit_fee NUMERIC(10,2) DEFAULT 0;

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

-- ============================================================
-- 5. CUSTOMER ORDER TRACKING
-- ============================================================

-- Tracking token for customers (separate from edit_token for quotes)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token ON orders (tracking_token) WHERE tracking_token IS NOT NULL;

-- Granular order stage for customer-facing progress
-- Values: quote_received, deposit_paid, design_in_progress, proof_ready,
--         inscription_approved, in_production, installation_scheduled, completed
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'quote_received';

-- Inscription tracking (on the order itself)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inscription_text TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inscription_status TEXT DEFAULT 'pending';
-- Values: pending, awaiting_approval, approved, change_requested

-- Proof image (uploaded by admin)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof_notes TEXT;

-- Estimated dates for customer visibility
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_completion TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_date TEXT;

-- Inscription change requests from customers
CREATE TABLE IF NOT EXISTS inscription_requests (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    requested_text TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending',  -- pending, accepted, declined
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inscription_requests_order ON inscription_requests (order_id);

-- Customer activity log (view history, for your reference)
CREATE TABLE IF NOT EXISTS customer_activity (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    action TEXT NOT NULL,  -- viewed, inscription_change, proof_viewed
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_activity_order ON customer_activity (order_id);

-- ============================================================
-- 6. PASSWORD RESET TOKENS (for partners)
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens (token);

-- ============================================================
-- 7. PEOPLE (unified retail contact registry)
-- ============================================================
-- One row per retail contact, deduped by email.
-- Every retail inbound (contact / quote / enquiry / appointment) upserts here.
-- `is_customer` is sticky-true once the person has at least one quote or order.
-- Partners are NOT stored here; they remain in the `partners` table.

CREATE TABLE IF NOT EXISTS people (
    id              SERIAL PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    phone           TEXT,
    is_customer     BOOLEAN DEFAULT FALSE,
    first_source    TEXT,                     -- 'contact' | 'quote' | 'enquiry' | 'appointment'
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_people_email ON people (lower(email));
CREATE INDEX IF NOT EXISTS idx_people_is_customer ON people (is_customer);

-- Link orders to people
ALTER TABLE orders ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES people(id);
CREATE INDEX IF NOT EXISTS idx_orders_person ON orders (person_id);

-- ------------------------------------------------------------
-- Backfill: one row per distinct email currently on orders
-- ------------------------------------------------------------
INSERT INTO people (email, name, phone, is_customer, first_source, first_seen_at, last_seen_at)
SELECT
    lower(customer_email)                    AS email,
    MIN(customer_name)                       AS name,
    MIN(customer_phone)                      AS phone,
    bool_or(order_type IN ('quote','order')) AS is_customer,
    MIN(order_type)                          AS first_source,
    MIN(created_at)                          AS first_seen_at,
    MAX(created_at)                          AS last_seen_at
FROM orders
WHERE customer_email IS NOT NULL
GROUP BY lower(customer_email)
ON CONFLICT (email) DO NOTHING;

-- Link existing orders to their person row
UPDATE orders o
SET person_id = p.id
FROM people p
WHERE p.email = lower(o.customer_email)
  AND o.person_id IS NULL;

-- ------------------------------------------------------------
-- VERIFICATION GATE (run manually before the DROP COLUMN block)
--   SELECT COUNT(*) FROM orders
--   WHERE customer_email IS NOT NULL AND person_id IS NULL;
--   -- expected: 0
-- ------------------------------------------------------------

ALTER TABLE orders DROP COLUMN IF EXISTS customer_name;
ALTER TABLE orders DROP COLUMN IF EXISTS customer_email;
ALTER TABLE orders DROP COLUMN IF EXISTS customer_phone;

-- ============================================================
-- 8. ADMIN ORDER ENHANCEMENTS (events log + admin notes)
-- ============================================================

-- Internal admin-only notes on an order (separate from `notes` which may
-- carry quote-time customer notes).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Order activity log: append-only audit trail of admin-driven changes.
-- event_type values: stage_changed, inscription_changed, proof_uploaded,
-- dates_updated, notes_updated, email_sent, deposit_marked, comment_added
CREATE TABLE IF NOT EXISTS order_events (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, created_at DESC);
