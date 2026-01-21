-- Test d'intégrité pour practitioner_weekly_availability
-- Execute with: psql -h localhost -U medicalpro -d <clinic_db> -f test_availability_integrity.sql

\echo '========================================'
\echo 'Tests d''intégrité - Disponibilités Praticiens'
\echo '========================================'

-- Test 1: Vérifier qu'aucune disponibilité n'existe sans praticien valide
\echo ''
\echo 'Test 1: Vérifier les références orphelines (provider_id invalide)'
SELECT COUNT(*) AS orphan_records FROM practitioner_weekly_availability pwa
LEFT JOIN healthcare_providers hp ON pwa.provider_id = hp.id
WHERE hp.id IS NULL;

-- Test 2: Vérifier les semaines valides (1-53)
\echo ''
\echo 'Test 2: Vérifier les semaines invalides (doit être 0)'
SELECT COUNT(*) AS invalid_weeks FROM practitioner_weekly_availability
WHERE week_number < 1 OR week_number > 53;

-- Test 3: Vérifier les années valides
\echo ''
\echo 'Test 3: Vérifier les années invalides (doit être 0)'
SELECT COUNT(*) AS invalid_years FROM practitioner_weekly_availability
WHERE year < 2020 OR year > 2100;

-- Test 4: Vérifier la structure JSONB availability (tous les jours présents)
\echo ''
\echo 'Test 4: Vérifier la structure JSONB (jours manquants)'
SELECT COUNT(*) AS incomplete_structure FROM practitioner_weekly_availability
WHERE NOT (
  availability ? 'monday' AND
  availability ? 'tuesday' AND
  availability ? 'wednesday' AND
  availability ? 'thursday' AND
  availability ? 'friday' AND
  availability ? 'saturday' AND
  availability ? 'sunday'
);

-- Test 5: Vérifier l'unicité provider/year/week
\echo ''
\echo 'Test 5: Vérifier les doublons (doit être 0)'
SELECT provider_id, year, week_number, COUNT(*) AS duplicates
FROM practitioner_weekly_availability
GROUP BY provider_id, year, week_number
HAVING COUNT(*) > 1;

-- Test 6: Vérifier la valeur du champ source
\echo ''
\echo 'Test 6: Vérifier les sources invalides (doit être 0)'
SELECT COUNT(*) AS invalid_sources FROM practitioner_weekly_availability
WHERE source NOT IN ('manual', 'copied', 'template');

-- Test 7: Statistiques générales
\echo ''
\echo 'Test 7: Statistiques générales'
SELECT
  COUNT(*) AS total_records,
  COUNT(DISTINCT provider_id) AS unique_providers,
  MIN(year) AS min_year,
  MAX(year) AS max_year,
  COUNT(CASE WHEN source = 'manual' THEN 1 END) AS manual_entries,
  COUNT(CASE WHEN source = 'copied' THEN 1 END) AS copied_entries,
  COUNT(CASE WHEN source = 'template' THEN 1 END) AS template_entries
FROM practitioner_weekly_availability;

-- Test 8: Vérifier les créneaux horaires valides (start < end)
\echo ''
\echo 'Test 8: Vérifier les créneaux invalides (start >= end)'
WITH slot_checks AS (
  SELECT
    id,
    provider_id,
    year,
    week_number,
    day_key,
    slot_idx,
    (slot->>'start')::time AS start_time,
    (slot->>'end')::time AS end_time
  FROM practitioner_weekly_availability,
    jsonb_each(availability) AS days(day_key, day_data),
    jsonb_array_elements(day_data->'slots') WITH ORDINALITY AS slots(slot, slot_idx)
)
SELECT COUNT(*) AS invalid_slots FROM slot_checks
WHERE start_time >= end_time;

\echo ''
\echo '========================================'
\echo 'Tests terminés'
\echo '========================================'
