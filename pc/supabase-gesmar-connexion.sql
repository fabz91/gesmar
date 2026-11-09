-- GESMAR : fermer la table « gesmar » au seul compte G20 (comme GESTIME, pc/supabase-connexion.sql).
-- À lancer EN DERNIER, quand TOUS les PC GESMAR (BREDIS, CLAMART, PC Videor…) et le téléphone sont connectés
-- avec l'identifiant G20 (Réglages → Compte → « Connecté : G20 »).
-- Supabase : menu « SQL Editor » > « New query » > coller > « Run ».
-- Un PC pas encore connecté ne pourra plus lire ni envoyer ses saisies : il affichera l'écran de connexion.
-- Ne touche ni à GESTIME, ni à GESCOUNT, ni à la table « gesmar_ventes ».

alter table public.gesmar enable row level security;

drop policy if exists "gesmar lecture" on public.gesmar;
drop policy if exists "gesmar ajout"   on public.gesmar;
drop policy if exists "gesmar modif"   on public.gesmar;

create policy "gesmar lecture" on public.gesmar for select to authenticated
  using (lower(auth.jwt()->>'email') = 'g20@hotmail.com');
create policy "gesmar ajout"   on public.gesmar for insert to authenticated
  with check (lower(auth.jwt()->>'email') = 'g20@hotmail.com');
create policy "gesmar modif"   on public.gesmar for update to authenticated
  using (lower(auth.jwt()->>'email') = 'g20@hotmail.com')
  with check (lower(auth.jwt()->>'email') = 'g20@hotmail.com');

revoke all on public.gesmar from anon;
grant select, insert, update on public.gesmar to authenticated;

select id, rev from public.gesmar order by id;  -- doit afficher 3 lignes : bredis, clamart, commun
