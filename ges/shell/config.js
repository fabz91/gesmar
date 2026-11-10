// ============================================================
//  GES - réglages (après une modification, refaites l'installateur avec CREER-INSTALLATEUR.bat)
// ============================================================
// Base en ligne (Supabase), commune aux 4 logiciels. Seulement la clé « publishable », jamais « secret » / « service_role ».
// Version publique : VIDE. Le kit privé du gérant contient les valeurs.
module.exports = {
  supabaseUrl: '',
  supabaseKey: '',
  // GES démarre avec Windows, en petite icône (mettre false pour l'empêcher)
  demarrageWindows: true
};
