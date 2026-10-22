-- =========================================================
-- SafeSpace — Module 38: Official PSGC address integration (Aurora)
--
-- Run in the Supabase SQL editor AFTER every prior module.
--
-- WHY — the "Cross-Platform Validation, Name Standardization, PSGC
-- Address Integration, Pagination, and Confirmation Dialogs" master
-- prompt requires administrative addresses (municipality/barangay) to
-- be backed by the official Philippine Standard Geographic Code
-- (PSGC), not a manually-maintained local list, with PSGC codes as
-- stable identifiers.
--
-- AUDIT FIRST — confirmed before writing this file:
--   * public.municipalities and public.barangays (00_schema.sql,
--     module3_barangay_hierarchy.sql) already exist, already carry a
--     unique name per province/municipality, and are already the
--     tables every address-selection screen in both apps queries
--     (ProfileScreen.tsx/RegisterScreen.tsx's MunicipalityPicker/
--     BarangayPicker, admin's MunicipalityManagementPage/
--     BarangayManagementPage). This migration ADDS a psgc_code column
--     to each rather than replacing the architecture — exactly the
--     "maintained local reference table, PSGC as the authoritative
--     source" design the governing spec explicitly sanctions.
--   * public.survivors already stores municipality_id/barangay_id as
--     FK references (module12_registered_address.sql) — i.e. it
--     already uses a stable identifier, not a free-text name. No
--     survivors schema change is needed for PSGC at all; only the
--     reference tables themselves need enrichment.
--   * The 8 Aurora municipalities were already correctly seeded by
--     name in module1_auth.sql (Baler, Maria Aurora, Dipaculao,
--     Casiguran, Dingalan, Dilasag, Dinalungan, San Luis) — confirmed
--     against the real PSGC data below, all 8 names match exactly.
--   * public.barangays has NEVER had any seed data in this project's
--     migration history (grepped every module file) — every barangay
--     in the live database today was entered manually, one at a time,
--     through the admin dashboard's Barangay Management screen, with
--     no governance against an official source. This migration is the
--     first time this table is checked against PSGC at all.
--
-- DATA SOURCE — the official PSA PSGC REST API
-- (https://classification.psa.gov.ph/psgc) requires an access token
-- obtained through PSA's own token-request page, a human registration
-- step neither this migration's author nor any automated tool can
-- complete. Per the governing spec's own guidance ("use a maintained
-- local reference table... document how it is populated from official
-- data" / "do not silently switch to an unofficial source" — disclosed
-- explicitly here rather than silently), the codes below were fetched
-- 2026-10-20 from https://psgc.gitlab.io/api — a long-established,
-- widely-used, read-only open republication of the same PSA-published
-- PSGC codes (no independent/invented data; it republishes the
-- official code list, it just doesn't gate it behind a token). Each
-- fetch was verified: Region III -> Aurora (province code 037700000)
-- -> its 8 municipalities -> each municipality's barangays, 151 rows
-- total across all 8. Swapping the SOURCE for the token-gated official
-- API later (once a real PSA token exists) requires no schema change
-- here — only re-running an equivalent upsert with that API's data.
--
-- Idempotent throughout: adding a column is `if not exists`; every
-- municipality/barangay write is an UPDATE-by-exact-name or an
-- INSERT .. ON CONFLICT that enriches an existing row with its real
-- code rather than creating a duplicate, and inserts only the (rare)
-- official barangay genuinely missing from the live table today. No
-- existing barangay row is ever deleted by this migration, even if its
-- name doesn't match anything below (e.g. a typo'd or since-renamed
-- entry) — those are left exactly as they are for manual review,
-- never silently altered or removed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. psgc_code columns
-- ---------------------------------------------------------
alter table public.municipalities add column if not exists psgc_code varchar(9);
alter table public.barangays add column if not exists psgc_code varchar(9);

comment on column public.municipalities.psgc_code is
  'The official 9-digit PSGC code for this municipality (PSA Philippine Standard Geographic Code). Nullable only for any row this migration could not match by exact name -- see module38''s header for the data source.';
comment on column public.barangays.psgc_code is
  'The official 9-digit PSGC code for this barangay. Nullable for any pre-existing row whose name does not exactly match the official PSGC barangay list for its municipality -- left for manual review rather than guessed or deleted.';

create unique index if not exists idx_municipalities_psgc_code on public.municipalities (psgc_code) where psgc_code is not null;
create unique index if not exists idx_barangays_psgc_code on public.barangays (psgc_code) where psgc_code is not null;

-- ---------------------------------------------------------
-- 2. Municipalities — enrich the 8 already-seeded Aurora rows by exact
--    name match. Does nothing if a municipality name here doesn't
--    exist in the live table (never inserts a municipality row).
-- ---------------------------------------------------------
update public.municipalities set psgc_code = '037701000' where municipality_name = 'Baler' and province = 'Aurora';
update public.municipalities set psgc_code = '037702000' where municipality_name = 'Casiguran' and province = 'Aurora';
update public.municipalities set psgc_code = '037703000' where municipality_name = 'Dilasag' and province = 'Aurora';
update public.municipalities set psgc_code = '037704000' where municipality_name = 'Dinalungan' and province = 'Aurora';
update public.municipalities set psgc_code = '037705000' where municipality_name = 'Dingalan' and province = 'Aurora';
update public.municipalities set psgc_code = '037706000' where municipality_name = 'Dipaculao' and province = 'Aurora';
update public.municipalities set psgc_code = '037707000' where municipality_name = 'Maria Aurora' and province = 'Aurora';
update public.municipalities set psgc_code = '037708000' where municipality_name = 'San Luis' and province = 'Aurora';

-- ---------------------------------------------------------
-- 3. Barangays — the full official PSGC barangay list for all 8 Aurora
--    municipalities (151 rows). Joined against municipalities by exact
--    name (scoped to province = 'Aurora' so this can never match a
--    same-named municipality in another province); upserts by the
--    existing (municipality_id, barangay_name) unique constraint —
--    enriches a matching existing row with its code, inserts any
--    official barangay missing from the live table today.
-- ---------------------------------------------------------
insert into public.barangays (municipality_id, barangay_name, psgc_code)
select m.municipality_id, v.barangay_name, v.psgc_code
from (values
  ('Baler', 'Barangay I (Pob.)', '037701001'),
  ('Baler', 'Barangay II (Pob.)', '037701002'),
  ('Baler', 'Barangay III (Pob.)', '037701003'),
  ('Baler', 'Barangay IV (Pob.)', '037701004'),
  ('Baler', 'Barangay V (Pob.)', '037701005'),
  ('Baler', 'Buhangin', '037701006'),
  ('Baler', 'Calabuanan', '037701007'),
  ('Baler', 'Obligacion', '037701008'),
  ('Baler', 'Pingit', '037701009'),
  ('Baler', 'Reserva', '037701010'),
  ('Baler', 'Sabang', '037701011'),
  ('Baler', 'Suclayin', '037701012'),
  ('Baler', 'Zabali', '037701013'),
  ('Casiguran', 'Barangay 1 (Pob.)', '037702001'),
  ('Casiguran', 'Barangay 2 (Pob.)', '037702002'),
  ('Casiguran', 'Barangay 3 (Pob.)', '037702003'),
  ('Casiguran', 'Barangay 4 (Pob.)', '037702004'),
  ('Casiguran', 'Barangay 5 (Pob.)', '037702005'),
  ('Casiguran', 'Barangay 6 (Pob.)', '037702006'),
  ('Casiguran', 'Barangay 7 (Pob.)', '037702007'),
  ('Casiguran', 'Barangay 8 (Pob.)', '037702008'),
  ('Casiguran', 'Calabgan', '037702009'),
  ('Casiguran', 'Calangcuasan', '037702010'),
  ('Casiguran', 'Calantas', '037702011'),
  ('Casiguran', 'Culat', '037702012'),
  ('Casiguran', 'Dibet', '037702013'),
  ('Casiguran', 'Esperanza', '037702014'),
  ('Casiguran', 'Lual', '037702015'),
  ('Casiguran', 'Marikit', '037702016'),
  ('Casiguran', 'Tabas', '037702017'),
  ('Casiguran', 'Tinib', '037702018'),
  ('Casiguran', 'Bianuan', '037702019'),
  ('Casiguran', 'Cozo', '037702020'),
  ('Casiguran', 'Dibacong', '037702021'),
  ('Casiguran', 'Ditinagyan', '037702022'),
  ('Casiguran', 'Esteves', '037702023'),
  ('Casiguran', 'San Ildefonso', '037702024'),
  ('Dilasag', 'Diagyan', '037703001'),
  ('Dilasag', 'Dicabasan', '037703002'),
  ('Dilasag', 'Dilaguidi', '037703003'),
  ('Dilasag', 'Dimaseset', '037703004'),
  ('Dilasag', 'Diniog', '037703005'),
  ('Dilasag', 'Lawang', '037703006'),
  ('Dilasag', 'Maligaya (Pob.)', '037703007'),
  ('Dilasag', 'Manggitahan', '037703008'),
  ('Dilasag', 'Masagana (Pob.)', '037703009'),
  ('Dilasag', 'Ura', '037703010'),
  ('Dilasag', 'Esperanza', '037703011'),
  ('Dinalungan', 'Abuleg', '037704001'),
  ('Dinalungan', 'Zone I (Pob.)', '037704002'),
  ('Dinalungan', 'Zone II (Pob.)', '037704003'),
  ('Dinalungan', 'Nipoo', '037704004'),
  ('Dinalungan', 'Dibaraybay', '037704005'),
  ('Dinalungan', 'Ditawini', '037704006'),
  ('Dinalungan', 'Mapalad', '037704007'),
  ('Dinalungan', 'Paleg', '037704008'),
  ('Dinalungan', 'Simbahan', '037704009'),
  ('Dingalan', 'Aplaya', '037705001'),
  ('Dingalan', 'Butas Na Bato', '037705002'),
  ('Dingalan', 'Cabog', '037705003'),
  ('Dingalan', 'Caragsacan', '037705004'),
  ('Dingalan', 'Davildavilan', '037705005'),
  ('Dingalan', 'Dikapanikian', '037705006'),
  ('Dingalan', 'Ibona', '037705007'),
  ('Dingalan', 'Paltic', '037705009'),
  ('Dingalan', 'Poblacion', '037705010'),
  ('Dingalan', 'Tanawan', '037705011'),
  ('Dingalan', 'Umiray', '037705013'),
  ('Dipaculao', 'Bayabas', '037706001'),
  ('Dipaculao', 'Buenavista', '037706002'),
  ('Dipaculao', 'Borlongan', '037706003'),
  ('Dipaculao', 'Calaocan', '037706004'),
  ('Dipaculao', 'Dianed', '037706005'),
  ('Dipaculao', 'Diarabasin', '037706006'),
  ('Dipaculao', 'Dibutunan', '037706007'),
  ('Dipaculao', 'Dimabuno', '037706008'),
  ('Dipaculao', 'Dinadiawan', '037706009'),
  ('Dipaculao', 'Ditale', '037706010'),
  ('Dipaculao', 'Gupa', '037706011'),
  ('Dipaculao', 'Ipil', '037706012'),
  ('Dipaculao', 'Laboy', '037706013'),
  ('Dipaculao', 'Lipit', '037706014'),
  ('Dipaculao', 'Lobbot', '037706015'),
  ('Dipaculao', 'Maligaya', '037706016'),
  ('Dipaculao', 'Mijares', '037706017'),
  ('Dipaculao', 'Mucdol', '037706018'),
  ('Dipaculao', 'North Poblacion', '037706019'),
  ('Dipaculao', 'Puangi', '037706020'),
  ('Dipaculao', 'Salay', '037706021'),
  ('Dipaculao', 'Sapangkawayan', '037706022'),
  ('Dipaculao', 'South Poblacion', '037706023'),
  ('Dipaculao', 'Toytoyan', '037706024'),
  ('Dipaculao', 'Diamanen', '037706025'),
  ('Maria Aurora', 'Alcala', '037707001'),
  ('Maria Aurora', 'Bagtu', '037707002'),
  ('Maria Aurora', 'Bangco', '037707003'),
  ('Maria Aurora', 'Bannawag', '037707004'),
  ('Maria Aurora', 'Barangay I (Pob.)', '037707005'),
  ('Maria Aurora', 'Barangay II (Pob.)', '037707006'),
  ('Maria Aurora', 'Barangay III (Pob.)', '037707007'),
  ('Maria Aurora', 'Barangay IV (Pob.)', '037707008'),
  ('Maria Aurora', 'Baubo', '037707009'),
  ('Maria Aurora', 'Bayanihan', '037707010'),
  ('Maria Aurora', 'Bazal', '037707011'),
  ('Maria Aurora', 'Cabituculan East', '037707012'),
  ('Maria Aurora', 'Cabituculan West', '037707013'),
  ('Maria Aurora', 'Debucao', '037707014'),
  ('Maria Aurora', 'Decoliat', '037707015'),
  ('Maria Aurora', 'Detailen', '037707016'),
  ('Maria Aurora', 'Diaat', '037707017'),
  ('Maria Aurora', 'Dialatman', '037707018'),
  ('Maria Aurora', 'Diaman', '037707019'),
  ('Maria Aurora', 'Dianawan', '037707020'),
  ('Maria Aurora', 'Dikildit', '037707021'),
  ('Maria Aurora', 'Dimanpudso', '037707022'),
  ('Maria Aurora', 'Diome', '037707023'),
  ('Maria Aurora', 'Estonilo', '037707024'),
  ('Maria Aurora', 'Florida', '037707025'),
  ('Maria Aurora', 'Galintuja', '037707026'),
  ('Maria Aurora', 'Cadayacan', '037707027'),
  ('Maria Aurora', 'Malasin', '037707028'),
  ('Maria Aurora', 'Ponglo', '037707029'),
  ('Maria Aurora', 'Quirino', '037707030'),
  ('Maria Aurora', 'Ramada', '037707031'),
  ('Maria Aurora', 'San Joaquin', '037707032'),
  ('Maria Aurora', 'San Jose', '037707033'),
  ('Maria Aurora', 'San Leonardo', '037707034'),
  ('Maria Aurora', 'Santa Lucia', '037707035'),
  ('Maria Aurora', 'Santo Tomas', '037707036'),
  ('Maria Aurora', 'Suguit', '037707037'),
  ('Maria Aurora', 'Villa Aurora', '037707038'),
  ('Maria Aurora', 'Wenceslao', '037707039'),
  ('Maria Aurora', 'San Juan', '037707040'),
  ('San Luis', 'Bacong', '037708001'),
  ('San Luis', 'Barangay I (Pob.)', '037708002'),
  ('San Luis', 'Barangay II (Pob.)', '037708003'),
  ('San Luis', 'Barangay III (Pob.)', '037708004'),
  ('San Luis', 'Barangay IV (Pob.)', '037708005'),
  ('San Luis', 'Dibalo', '037708006'),
  ('San Luis', 'Dibayabay', '037708007'),
  ('San Luis', 'Dibut', '037708008'),
  ('San Luis', 'Dikapinisan', '037708009'),
  ('San Luis', 'Dimanayat', '037708010'),
  ('San Luis', 'Diteki', '037708011'),
  ('San Luis', 'Ditumabo', '037708012'),
  ('San Luis', 'L. Pimentel', '037708013'),
  ('San Luis', 'Nonong Senior', '037708014'),
  ('San Luis', 'Real', '037708015'),
  ('San Luis', 'San Isidro', '037708016'),
  ('San Luis', 'San Jose', '037708017'),
  ('San Luis', 'Zarah', '037708018')
) as v(municipality_name, barangay_name, psgc_code)
join public.municipalities m on m.municipality_name = v.municipality_name and m.province = 'Aurora'
on conflict (municipality_id, barangay_name) do update set psgc_code = excluded.psgc_code;


-- =========================================================
-- VERIFICATION — run separately, after everything above. This
-- migration was written without live database access in this
-- environment (same caveat as every other module in this project) —
-- confirm every result below against the live project before relying
-- on it.
-- =========================================================

-- 1. All 8 municipalities now have a code:
--   select municipality_name, psgc_code from public.municipalities where province = 'Aurora' order by municipality_name;
--   -- expect 8 rows, all psgc_code non-null.

-- 2. How many existing barangay rows got enriched vs. how many were
--    newly inserted, and how many pre-existing rows have NO official
--    match (candidates for manual review -- a renamed/typo'd entry, or
--    a genuinely non-standard local name):
--   select count(*) filter (where psgc_code is not null) as matched,
--          count(*) filter (where psgc_code is null) as unmatched,
--          count(*) as total
--   from public.barangays b join public.municipalities m using (municipality_id)
--   where m.province = 'Aurora';

-- 3. List any unmatched rows by name, for manual review (never
--    auto-corrected or deleted by this migration):
--   select m.municipality_name, b.barangay_name
--   from public.barangays b join public.municipalities m using (municipality_id)
--   where m.province = 'Aurora' and b.psgc_code is null
--   order by m.municipality_name, b.barangay_name;

-- 4. Confirm no duplicate barangay was created (same municipality +
--    name should still be exactly one row, per the pre-existing unique
--    constraint -- this query should always return zero rows):
--   select municipality_id, barangay_name, count(*) from public.barangays
--   group by municipality_id, barangay_name having count(*) > 1;
