-- Bring the production schema in line with the customer/admin portal workflow.

alter table public.orders
  add column if not exists stage text not null default 'quote_received';

alter table public.orders
  drop constraint if exists orders_stage_check;

alter table public.orders
  add constraint orders_stage_check check (stage in (
    'quote_received',
    'deposit_paid',
    'design_in_progress',
    'proof_ready',
    'inscription_approved',
    'in_production',
    'installation_scheduled',
    'completed'
  ));

