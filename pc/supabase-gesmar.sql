-- GESMAR : table de synchronisation entre les PC (même principe que GESTIME).
-- À coller UNE FOIS dans Supabase : menu « SQL Editor » > « New query » > coller > « Run ».
-- Ne touche pas aux données de GESTIME. Peut être relancé sans risque.

create table if not exists public.gesmar (
  id         text primary key,                   -- 'bredis', 'clamart', 'commun' (logo)
  data       jsonb not null default '{}'::jsonb,  -- toutes les données du magasin
  rev        integer not null default 0,          -- numéro de révision (évite qu'un poste écrase l'autre)
  updated_at timestamptz not null default now()
);

alter table public.gesmar enable row level security;

-- Même accès que GESTIME : le logiciel s'ouvre sans mot de passe, avec la clé « publishable ».
drop policy if exists "gesmar lecture" on public.gesmar;
drop policy if exists "gesmar ajout"   on public.gesmar;
drop policy if exists "gesmar modif"   on public.gesmar;
create policy "gesmar lecture" on public.gesmar for select to anon, authenticated using (true);
create policy "gesmar ajout"   on public.gesmar for insert to anon, authenticated with check (true);
create policy "gesmar modif"   on public.gesmar for update to anon, authenticated using (true) with check (true);
grant select, insert, update on public.gesmar to anon, authenticated;

insert into public.gesmar (id) values ('commun'), ('bredis'), ('clamart') on conflict (id) do nothing;

select id, rev from public.gesmar order by id;  -- doit afficher 3 lignes : bredis, clamart, commun
