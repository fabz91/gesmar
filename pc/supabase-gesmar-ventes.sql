-- GESMAR, onglet VENTE : les journées de caisse (Videor) envoyées par le PC de la caisse, lues par les autres PC.
-- À coller UNE FOIS dans Supabase : menu « SQL Editor » > « New query » > coller > « Run ». Peut être relancé sans risque.
create table if not exists public.gesmar_ventes (
  id         text primary key,                   -- 'bredis|2026-11-07'
  magasin    text not null,                      -- 'bredis' ou 'clamart'
  jour       date not null,
  data       jsonb not null default '{}'::jsonb,  -- la journée : rayons, familles, sous-familles, articles, heures, paiements…
  updated_at timestamptz not null default now()
);
create index if not exists gesmar_ventes_mag_jour on public.gesmar_ventes (magasin, jour);
alter table public.gesmar_ventes enable row level security;
drop policy if exists "ventes lecture" on public.gesmar_ventes;
drop policy if exists "ventes ajout"   on public.gesmar_ventes;
drop policy if exists "ventes modif"   on public.gesmar_ventes;
create policy "ventes lecture" on public.gesmar_ventes for select to anon, authenticated using (true);
create policy "ventes ajout"   on public.gesmar_ventes for insert to anon, authenticated with check (true);
create policy "ventes modif"   on public.gesmar_ventes for update to anon, authenticated using (true) with check (true);
grant select, insert, update on public.gesmar_ventes to anon, authenticated;
select count(*) as journees from public.gesmar_ventes;  -- doit afficher un nombre (0 au début)
