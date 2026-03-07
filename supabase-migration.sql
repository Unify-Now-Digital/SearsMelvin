-- Migration: Add quote editing and tracking columns to orders table
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- Add edit_token column for quote editing via email link
ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_token TEXT;

-- Add product_config column to store full product configuration as JSON
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_config TEXT;

-- Add notes column for customer messages
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add updated_at column for tracking edits
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Add status column if not exists
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Index on edit_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_orders_edit_token ON orders (edit_token) WHERE edit_token IS NOT NULL;

-- Index on customer_email + order_type for quote tracking
CREATE INDEX IF NOT EXISTS idx_orders_email_type ON orders (customer_email, order_type);
