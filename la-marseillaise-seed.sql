-- =====================================================================
-- Auto-école La Marseillaise: Realistic Seed Data (Cameroon / CEMAC)
-- =====================================================================

do $$
declare
  v_cat_a uuid;
  v_cat_b uuid;
  v_cat_c uuid;
  v_cat_d uuid;
  v_grp_b_nov uuid;
  v_grp_a_nov uuid;
  v_grp_c_dec uuid;
  v_quiz_signalisation uuid;
  v_quiz_priorite uuid;
  v_quiz_blanc_b uuid;
  v_quiz_moto_a uuid;
begin
  select id into v_cat_a from public.licence_categories where code = 'A';
  select id into v_cat_b from public.licence_categories where code = 'B';
  select id into v_cat_c from public.licence_categories where code = 'C';
  select id into v_cat_d from public.licence_categories where code = 'D';

  -- 1. Sample Groups & Installment Plans (FCFA)
  if not exists (select 1 from public.groups where name = 'Promotion Novembre — Permis B (Soir & Week-end)') then
    insert into public.groups (licence_category_id, name, start_date, capacity, total_fee, status)
    values (v_cat_b, 'Promotion Novembre — Permis B (Soir & Week-end)', current_date + 7, 30, 120000, 'open')
    returning id into v_grp_b_nov;

    insert into public.installments (group_id, position, label, amount, due_date) values
      (v_grp_b_nov, 1, '1re tranche (Inscription & Code)', 50000, current_date + 7),
      (v_grp_b_nov, 2, '2e tranche (Début Conduite)',      40000, current_date + 30),
      (v_grp_b_nov, 3, '3e tranche (Solde avant examen)',  30000, current_date + 60);
  end if;

  if not exists (select 1 from public.groups where name = 'Promotion Novembre — Permis A (Moto Express)') then
    insert into public.groups (licence_category_id, name, start_date, capacity, total_fee, status)
    values (v_cat_a, 'Promotion Novembre — Permis A (Moto Express)', current_date + 5, 25, 75000, 'open')
    returning id into v_grp_a_nov;

    insert into public.installments (group_id, position, label, amount, due_date) values
      (v_grp_a_nov, 1, '1re tranche (Inscription)', 40000, current_date + 5),
      (v_grp_a_nov, 2, '2e tranche (Solde)',        35000, current_date + 30);
  end if;

  if not exists (select 1 from public.groups where name = 'Session Décembre — Permis C (Poids Lourds)') then
    insert into public.groups (licence_category_id, name, start_date, capacity, total_fee, status)
    values (v_cat_c, 'Session Décembre — Permis C (Poids Lourds)', current_date + 20, 15, 180000, 'open')
    returning id into v_grp_c_dec;

    insert into public.installments (group_id, position, label, amount, due_date) values
      (v_grp_c_dec, 1, '1re tranche (Inscription)',       70000, current_date + 20),
      (v_grp_c_dec, 2, '2e tranche (Manœuvres)',          60000, current_date + 45),
      (v_grp_c_dec, 3, '3e tranche (Solde examen)',       50000, current_date + 75);
  end if;

  -- 2. Course Resources (Permis B & A)
  if not exists (select 1 from public.resources where title = 'Manuel Complet du Code de la Route (Zone CEMAC / Cameroun)') then
    insert into public.resources (licence_category_id, title, description, type, storage_path, file_size_kb, sort_order, is_published)
    values
      (v_cat_b, 'Manuel Complet du Code de la Route (Zone CEMAC / Cameroun)',
       'Tous les panneaux de signalisation, règles de priorité, croisements et dépassements au Cameroun.',
       'pdf', 'permis-b/manuel-code-cemac.pdf', 1840, 1, true),
      (v_cat_b, 'Fiche Révision : Les Panneaux de Danger, Interdiction et Obligation',
       'Planche illustrée haute résolution à télécharger pour réviser hors ligne avant l''examen.',
       'pdf', 'permis-b/fiche-panneaux-signalisation.pdf', 620, 2, true),
      (v_cat_b, 'Vidéo : Maîtriser le démarrage en côte et le créneau',
       'Démonstration pratique étape par étape avec les moniteurs de La Marseillaise.',
       'video', 'permis-b/video-demarrage-cote-creneau.mp4', 8450, 3, true),
      (v_cat_b, 'Fiche Révision : Distances de sécurité, alcoolémie et vitesse',
       'Les chiffres clés exigés à l''examen officiel du permis de conduire.',
       'pdf', 'permis-b/fiche-distances-vitesse.pdf', 410, 4, true),
      (v_cat_a, 'Guide Officiel Permis A : Équipement, Équilibre et Signalisation Moto',
       'Les règles spécifiques aux deux-roues motorisés et la sécurité routière en milieu urbain.',
       'pdf', 'permis-a/guide-moto-permis-a.pdf', 1120, 1, true);
  end if;

  -- 3. Quizzes & Questions (Offline-ready Question Packs)
  if not exists (select 1 from public.quizzes where title = 'Série 1 : Signalisation Routière & Panneaux') then
    insert into public.quizzes (licence_category_id, title, topic, duration_minutes, is_mock_exam, is_published)
    values (v_cat_b, 'Série 1 : Signalisation Routière & Panneaux', 'Signalisation', 15, false, true)
    returning id into v_quiz_signalisation;

    insert into public.questions (quiz_id, position, body, options, correct_index, explanation) values
      (v_quiz_signalisation, 1,
       'Quelle est la forme d''un panneau de danger temporaire ou permanent ?',
       '["Ronde à bordure rouge", "Triangulaire pointe en haut", "Carrée à fond bleu", "Octogonale rouge"]'::jsonb,
       1,
       'Les panneaux de danger sont toujours triangulaires avec la pointe dirigée vers le haut. En agglomération, ils sont placés à environ 50 m du danger et à 150 m hors agglomération.'),
      (v_quiz_signalisation, 2,
       'Devant un panneau STOP (AB4), où devez-vous obligatoirement marquer l''arrêt ?',
       '["Au niveau du panneau uniquement", "À la limite de la bande blanche transversale (ou à défaut à la limite de la chaussée abordée)", "Uniquement si un véhicule arrive à gauche", "Ralentir suffit si la visibilité est bonne"]'::jsonb,
       1,
       'Au panneau STOP, l''arrêt complet est obligatoire à la ligne blanche d''arrêt, même si aucun usager n''est visible.'),
      (v_quiz_signalisation, 3,
       'Que signifie un panneau rond à fond bleu avec une flèche blanche ?',
       '["Une interdiction de tourner", "Une obligation de suivre la direction indiquée par la flèche", "Une indication d''itinéraire conseillé", "Une fin d''obligation"]'::jsonb,
       1,
       'Les panneaux ronds à fond bleu expriment une obligation. Vous devez suivre la direction indiquée au prochain carrefour.'),
      (v_quiz_signalisation, 4,
       'En agglomération au Cameroun, sauf indication contraire, quelle est la vitesse maximale autorisée ?',
       '["40 km/h", "50 km/h", "60 km/h", "80 km/h"]'::jsonb,
       2,
       'Dans la zone CEMAC / Cameroun, la vitesse maximale en agglomération est généralement limitée à 60 km/h (ou 50 km/h selon la signalisation locale spécifique).'),
      (v_quiz_signalisation, 5,
       'Une ligne continue blanche au milieu de la chaussée vous autorise-t-elle à dépasser un véhicule lent ?',
       '["Oui, si la visibilité est excellente", "Non, il est strictement interdit de franchir ou chevaucher une ligne continue", "Oui, en klaxonnant", "Oui, uniquement de jour"]'::jsonb,
       1,
       'Il est formellement interdit de franchir ou de chevaucher une ligne continue.');
  end if;

  if not exists (select 1 from public.quizzes where title = 'Série 2 : Règles de Priorité & Intersections') then
    insert into public.quizzes (licence_category_id, title, topic, duration_minutes, is_mock_exam, is_published)
    values (v_cat_b, 'Série 2 : Règles de Priorité & Intersections', 'Priorités', 15, false, true)
    returning id into v_quiz_priorite;

    insert into public.questions (quiz_id, position, body, options, correct_index, explanation) values
      (v_quiz_priorite, 1,
       'À une intersection sans aucune signalisation ni marquage au sol, quelle règle s''applique ?',
       '["Priorité au véhicule le plus gros", "Priorité à droite", "Priorité à gauche", "Le premier arrivé passe"]'::jsonb,
       1,
       'En l''absence de signalisation à un carrefour, la règle générale est la priorité à droite.'),
      (v_quiz_priorite, 2,
       'Vous abordez un carrefour à sens giratoire annoncé par le panneau « Cédez le passage ». Qui a la priorité ?',
       '["Les véhicules qui entrent dans le rond-point", "Les véhicules déjà engagés dans l''anneau (venant de gauche)", "Les véhicules venant de droite", "Les deux-roues uniquement"]'::jsonb,
       1,
       'Dans un carrefour à sens giratoire avec signal « Cédez le passage », la priorité appartient aux usagers déjà engagés sur l''anneau.'),
      (v_quiz_priorite, 3,
       'Un véhicule d''urgence (ambulance, pompiers) approche avec ses avertisseurs lumineux et sonores en marche. Que faites-vous ?',
       '["Vous maintenez votre allure", "Vous ralentissez, serrez à droite et lui cédez immédiatement le passage", "Vous accélérez pour ne pas le gêner", "Vous vous arrêtez au milieu du carrefour"]'::jsonb,
       1,
       'Tout usager doit dégager la voie et faciliter le passage d''un véhicule prioritaire en mission d''urgence.');
  end if;

  if not exists (select 1 from public.quizzes where title = 'Examen Blanc Officiel N°1 — Permis B') then
    insert into public.quizzes (licence_category_id, title, topic, duration_minutes, is_mock_exam, is_published)
    values (v_cat_b, 'Examen Blanc Officiel N°1 — Permis B', 'Examen Blanc', 20, true, true)
    returning id into v_quiz_blanc_b;

    insert into public.questions (quiz_id, position, body, options, correct_index, explanation) values
      (v_quiz_blanc_b, 1,
       'Pour calculer approximativement la distance de sécurité minimale en secondes derrière un véhicule, quel intervalle faut-il laisser ?',
       '["Au moins 2 secondes", "Une demi-seconde", "Uniquement la longueur d''une voiture", "500 mètres"]'::jsonb,
       0,
       'Le temps de réaction étant d''environ 1 seconde, il faut laisser au minimum 2 secondes d''intervalle avec le véhicule qui précède.'),
      (v_quiz_blanc_b, 2,
       'En cas de pluie, comment évolue la distance de freinage par rapport à une chaussée sèche ?',
       '["Elle reste identique", "Elle est multipliée par près de 2 (allongée d''environ 50 % à 100 %)", "Elle diminue grâce à l''eau", "Elle ne dépend que de la marque des pneus"]'::jsonb,
       1,
       'Sur chaussée mouillée, l''adhérence diminue fortement : la distance de freinage est environ doublée.'),
      (v_quiz_blanc_b, 3,
       'Avant d''effectuer un dépassement, quelle est la première vérification indispensable ?',
       '["Actionner le klaxon", "Vérifier dans les rétroviseurs et l''angle mort qu''aucun usager n''a commencé à vous dépasser", "Allumer les feux de détresse", "Passer au point mort"]'::jsonb,
       1,
       'Avant de déboîter, il faut s''assurer que la voie est libre devant ET derrière (rétroviseurs + contrôle direct de l''angle mort).'),
      (v_quiz_blanc_b, 4,
       'La nuit, lorsque vous croisez un autre véhicule, quels feux devez-vous utiliser ?',
       '["Les feux de route (pleins phares)", "Les feux de croisement (codes)", "Les feux de position seuls", "Les feux de brouillard arrière"]'::jsonb,
       1,
       'Pour ne pas éblouir l''usager venant en sens inverse, il faut passer des feux de route aux feux de croisement.');
  end if;

  if not exists (select 1 from public.quizzes where title = 'Quiz Spécial Permis A — Sécurité & Conduite Moto') then
    insert into public.quizzes (licence_category_id, title, topic, duration_minutes, is_mock_exam, is_published)
    values (v_cat_a, 'Quiz Spécial Permis A — Sécurité & Conduite Moto', 'Deux-roues', 10, false, true)
    returning id into v_quiz_moto_a;

    insert into public.questions (quiz_id, position, body, options, correct_index, explanation) values
      (v_quiz_moto_a, 1,
       'Quel équipement est strictement obligatoire pour le conducteur et le passager d''une motocyclette ?',
       '["Des lunettes de soleil", "Un casque homologué correctement attaché", "Un gilet de sauvetage", "Des chaussures de sport"]'::jsonb,
       1,
       'Le port du casque homologué et attaché est obligatoire pour le conducteur comme pour le passager : un casque non attaché est éjecté dès le premier choc.');
  end if;
end $$;
