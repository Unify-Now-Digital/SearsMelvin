-- A partner may have only one issued link at a time. The API deletes the old
-- row before issuing a new link; this constraint also closes simultaneous
-- request races so two usable links can never survive.

create unique index if not exists partner_magic_link_tokens_one_per_partner_idx
  on public.partner_magic_link_tokens (partner_id);
