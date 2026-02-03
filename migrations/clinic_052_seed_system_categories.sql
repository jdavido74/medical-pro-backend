-- Migration: Seed system_categories with initial data
-- Inserts all base consent types, appointment types, specialties, and departments

-- ============================================================================
-- CONSENT TYPES (14 types)
-- ============================================================================

INSERT INTO system_categories (code, category_type, translations, metadata, sort_order, is_system)
VALUES
-- Medical Treatment
('medical_treatment', 'consent_type',
 '{"es": {"name": "Tratamiento médico", "description": "Consentimiento para intervenciones y cuidados médicos generales"},
   "fr": {"name": "Soins médicaux", "description": "Consentement pour interventions et soins médicaux généraux"},
   "en": {"name": "Medical Care", "description": "Consent for general medical interventions and care"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Heart", "color": "blue"}',
 1, true),

-- Surgery
('surgery', 'consent_type',
 '{"es": {"name": "Cirugía", "description": "Consentimiento para intervenciones quirúrgicas"},
   "fr": {"name": "Chirurgie", "description": "Consentement pour interventions chirurgicales"},
   "en": {"name": "Surgery", "description": "Consent for surgical interventions"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Scissors", "color": "red"}',
 2, true),

-- Anesthesia
('anesthesia', 'consent_type',
 '{"es": {"name": "Anestesia", "description": "Consentimiento para actos anestésicos"},
   "fr": {"name": "Anesthésie", "description": "Consentement pour actes anesthésiques"},
   "en": {"name": "Anesthesia", "description": "Consent for anesthetic procedures"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Moon", "color": "purple"}',
 3, true),

-- Diagnostic
('diagnostic', 'consent_type',
 '{"es": {"name": "Exámenes diagnósticos", "description": "Consentimiento para exámenes y pruebas diagnósticas"},
   "fr": {"name": "Examens diagnostiques", "description": "Consentement pour examens et tests diagnostiques"},
   "en": {"name": "Diagnostic Exams", "description": "Consent for diagnostic exams and tests"}}',
 '{"required": false, "renewable": true, "defaultDuration": 365, "icon": "Search", "color": "indigo"}',
 4, true),

-- Telehealth
('telehealth', 'consent_type',
 '{"es": {"name": "Telemedicina", "description": "Consentimiento para consultas a distancia"},
   "fr": {"name": "Télémédecine", "description": "Consentement pour consultations à distance"},
   "en": {"name": "Telehealth", "description": "Consent for remote consultations"}}',
 '{"required": false, "renewable": true, "defaultDuration": 365, "icon": "Video", "color": "cyan"}',
 5, true),

-- Clinical Trial
('clinical_trial', 'consent_type',
 '{"es": {"name": "Ensayo clínico", "description": "Consentimiento para participación en ensayo clínico o investigación"},
   "fr": {"name": "Essai clinique", "description": "Consentement pour participation à un essai clinique ou recherche"},
   "en": {"name": "Clinical Trial", "description": "Consent for clinical trial or research participation"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "FlaskConical", "color": "orange"}',
 6, true),

-- Minor Treatment
('minor_treatment', 'consent_type',
 '{"es": {"name": "Tratamiento de menor", "description": "Consentimiento parental para cuidados de menores"},
   "fr": {"name": "Traitement de mineur", "description": "Consentement parental pour soins sur mineur"},
   "en": {"name": "Minor Treatment", "description": "Parental consent for minor care"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Baby", "color": "pink"}',
 7, true),

-- Data Processing (GDPR)
('data_processing', 'consent_type',
 '{"es": {"name": "RGPD / Datos personales", "description": "Consentimiento para el tratamiento de datos personales (RGPD)"},
   "fr": {"name": "RGPD / Données personnelles", "description": "Consentement pour le traitement des données personnelles (RGPD)"},
   "en": {"name": "Data Protection (GDPR)", "description": "Consent for personal data processing (GDPR)"}}',
 '{"required": true, "renewable": true, "defaultDuration": null, "icon": "Database", "color": "gray"}',
 8, true),

-- Photo
('photo', 'consent_type',
 '{"es": {"name": "Derecho de imagen", "description": "Consentimiento para toma y uso de fotos/vídeos"},
   "fr": {"name": "Droit à l''image", "description": "Consentement pour prise et utilisation de photos/vidéos"},
   "en": {"name": "Image Rights", "description": "Consent for taking and using photos/videos"}}',
 '{"required": false, "renewable": true, "defaultDuration": 365, "icon": "Camera", "color": "amber"}',
 9, true),

-- Communication
('communication', 'consent_type',
 '{"es": {"name": "Comunicación", "description": "Consentimiento para comunicaciones de marketing y newsletters"},
   "fr": {"name": "Communication", "description": "Consentement pour communications marketing et newsletters"},
   "en": {"name": "Communication", "description": "Consent for marketing communications and newsletters"}}',
 '{"required": false, "renewable": true, "defaultDuration": 365, "icon": "Mail", "color": "green"}',
 10, true),

-- Dental
('dental', 'consent_type',
 '{"es": {"name": "Cuidados dentales", "description": "Consentimiento específico para cuidados dentales"},
   "fr": {"name": "Soins dentaires", "description": "Consentement spécifique pour soins dentaires"},
   "en": {"name": "Dental Care", "description": "Specific consent for dental care"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Smile", "color": "teal"}',
 11, true),

-- Mental Health
('mental_health', 'consent_type',
 '{"es": {"name": "Salud mental", "description": "Consentimiento para cuidados de salud mental"},
   "fr": {"name": "Santé mentale", "description": "Consentement pour soins en santé mentale"},
   "en": {"name": "Mental Health", "description": "Consent for mental health care"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Brain", "color": "violet"}',
 12, true),

-- Prevention
('prevention', 'consent_type',
 '{"es": {"name": "Prevención / Vacunación", "description": "Consentimiento para actos de prevención y vacunaciones"},
   "fr": {"name": "Prévention / Vaccination", "description": "Consentement pour actes de prévention et vaccinations"},
   "en": {"name": "Prevention / Vaccination", "description": "Consent for prevention procedures and vaccinations"}}',
 '{"required": false, "renewable": true, "defaultDuration": 365, "icon": "Shield", "color": "lime"}',
 13, true),

-- General Care
('general_care', 'consent_type',
 '{"es": {"name": "Cuidados generales", "description": "Consentimiento general para atención médica"},
   "fr": {"name": "Soins généraux", "description": "Consentement général pour prise en charge médicale"},
   "en": {"name": "General Care", "description": "General consent for medical care"}}',
 '{"required": true, "renewable": false, "defaultDuration": null, "icon": "Stethoscope", "color": "sky"}',
 14, true)

ON CONFLICT (category_type, code) DO UPDATE SET
    translations = EXCLUDED.translations,
    metadata = EXCLUDED.metadata,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    updated_at = NOW();


-- ============================================================================
-- APPOINTMENT TYPES (7 types)
-- ============================================================================

INSERT INTO system_categories (code, category_type, translations, metadata, sort_order, is_system)
VALUES
('consultation', 'appointment_type',
 '{"es": {"name": "Consulta", "description": "Consulta médica estándar"},
   "fr": {"name": "Consultation", "description": "Consultation médicale standard"},
   "en": {"name": "Consultation", "description": "Standard medical consultation"}}',
 '{"duration": 30, "color": "blue", "priority": "normal"}',
 1, true),

('followup', 'appointment_type',
 '{"es": {"name": "Seguimiento", "description": "Cita de seguimiento"},
   "fr": {"name": "Suivi", "description": "Rendez-vous de suivi"},
   "en": {"name": "Follow-up", "description": "Follow-up appointment"}}',
 '{"duration": 20, "color": "green", "priority": "normal"}',
 2, true),

('emergency', 'appointment_type',
 '{"es": {"name": "Urgencia", "description": "Consulta de urgencia"},
   "fr": {"name": "Urgence", "description": "Consultation d''urgence"},
   "en": {"name": "Emergency", "description": "Emergency consultation"}}',
 '{"duration": 45, "color": "red", "priority": "urgent"}',
 3, true),

('specialist', 'appointment_type',
 '{"es": {"name": "Especialista", "description": "Consulta con especialista"},
   "fr": {"name": "Spécialiste", "description": "Consultation spécialisée"},
   "en": {"name": "Specialist", "description": "Specialist consultation"}}',
 '{"duration": 45, "color": "purple", "priority": "normal"}',
 4, true),

('checkup', 'appointment_type',
 '{"es": {"name": "Chequeo", "description": "Examen médico completo"},
   "fr": {"name": "Bilan de santé", "description": "Examen médical complet"},
   "en": {"name": "Checkup", "description": "Complete medical examination"}}',
 '{"duration": 60, "color": "teal", "priority": "low"}',
 5, true),

('vaccination', 'appointment_type',
 '{"es": {"name": "Vacunación", "description": "Administración de vacunas"},
   "fr": {"name": "Vaccination", "description": "Administration de vaccins"},
   "en": {"name": "Vaccination", "description": "Vaccine administration"}}',
 '{"duration": 15, "color": "orange", "priority": "normal"}',
 6, true),

('surgery', 'appointment_type',
 '{"es": {"name": "Cirugía", "description": "Intervención quirúrgica"},
   "fr": {"name": "Chirurgie", "description": "Intervention chirurgicale"},
   "en": {"name": "Surgery", "description": "Surgical intervention"}}',
 '{"duration": 120, "color": "pink", "priority": "high"}',
 7, true)

ON CONFLICT (category_type, code) DO UPDATE SET
    translations = EXCLUDED.translations,
    metadata = EXCLUDED.metadata,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    updated_at = NOW();


-- ============================================================================
-- MEDICAL SPECIALTIES (20 specialties)
-- ============================================================================

INSERT INTO system_categories (code, category_type, translations, metadata, sort_order, is_system)
VALUES
('general_medicine', 'specialty',
 '{"es": {"name": "Medicina General", "description": "Atención médica primaria"},
   "fr": {"name": "Médecine Générale", "description": "Soins médicaux primaires"},
   "en": {"name": "General Medicine", "description": "Primary medical care"}}',
 '{"icon": "Stethoscope", "color": "blue", "modules": ["base"]}',
 1, true),

('cardiology', 'specialty',
 '{"es": {"name": "Cardiología", "description": "Especialidad del corazón y sistema cardiovascular"},
   "fr": {"name": "Cardiologie", "description": "Spécialité du cœur et système cardiovasculaire"},
   "en": {"name": "Cardiology", "description": "Heart and cardiovascular system specialty"}}',
 '{"icon": "Heart", "color": "red", "modules": ["base", "cardiac"]}',
 2, true),

('dermatology', 'specialty',
 '{"es": {"name": "Dermatología", "description": "Especialidad de la piel"},
   "fr": {"name": "Dermatologie", "description": "Spécialité de la peau"},
   "en": {"name": "Dermatology", "description": "Skin specialty"}}',
 '{"icon": "Scan", "color": "orange", "modules": ["base"]}',
 3, true),

('pediatrics', 'specialty',
 '{"es": {"name": "Pediatría", "description": "Medicina infantil"},
   "fr": {"name": "Pédiatrie", "description": "Médecine infantile"},
   "en": {"name": "Pediatrics", "description": "Children''s medicine"}}',
 '{"icon": "Baby", "color": "pink", "modules": ["base", "pediatric"]}',
 4, true),

('gynecology', 'specialty',
 '{"es": {"name": "Ginecología", "description": "Salud femenina y obstetricia"},
   "fr": {"name": "Gynécologie", "description": "Santé féminine et obstétrique"},
   "en": {"name": "Gynecology", "description": "Women''s health and obstetrics"}}',
 '{"icon": "Users", "color": "purple", "modules": ["base"]}',
 5, true),

('orthopedics', 'specialty',
 '{"es": {"name": "Ortopedia", "description": "Sistema musculoesquelético"},
   "fr": {"name": "Orthopédie", "description": "Système musculo-squelettique"},
   "en": {"name": "Orthopedics", "description": "Musculoskeletal system"}}',
 '{"icon": "Bone", "color": "gray", "modules": ["base", "surgery"]}',
 6, true),

('ophthalmology', 'specialty',
 '{"es": {"name": "Oftalmología", "description": "Especialidad de los ojos"},
   "fr": {"name": "Ophtalmologie", "description": "Spécialité des yeux"},
   "en": {"name": "Ophthalmology", "description": "Eye specialty"}}',
 '{"icon": "Eye", "color": "cyan", "modules": ["base"]}',
 7, true),

('dentistry', 'specialty',
 '{"es": {"name": "Odontología", "description": "Salud dental"},
   "fr": {"name": "Dentisterie", "description": "Santé dentaire"},
   "en": {"name": "Dentistry", "description": "Dental health"}}',
 '{"icon": "Smile", "color": "teal", "modules": ["base"]}',
 8, true),

('nursing', 'specialty',
 '{"es": {"name": "Enfermería", "description": "Cuidados de enfermería"},
   "fr": {"name": "Soins infirmiers", "description": "Soins infirmiers"},
   "en": {"name": "Nursing", "description": "Nursing care"}}',
 '{"icon": "Activity", "color": "green", "modules": ["base"]}',
 9, true),

('physiotherapy', 'specialty',
 '{"es": {"name": "Fisioterapia", "description": "Rehabilitación física"},
   "fr": {"name": "Kinésithérapie", "description": "Rééducation physique"},
   "en": {"name": "Physiotherapy", "description": "Physical rehabilitation"}}',
 '{"icon": "Activity", "color": "lime", "modules": ["base"]}',
 10, true),

('psychiatry', 'specialty',
 '{"es": {"name": "Psiquiatría", "description": "Salud mental"},
   "fr": {"name": "Psychiatrie", "description": "Santé mentale"},
   "en": {"name": "Psychiatry", "description": "Mental health"}}',
 '{"icon": "Brain", "color": "violet", "modules": ["base"]}',
 11, true),

('neurology', 'specialty',
 '{"es": {"name": "Neurología", "description": "Sistema nervioso"},
   "fr": {"name": "Neurologie", "description": "Système nerveux"},
   "en": {"name": "Neurology", "description": "Nervous system"}}',
 '{"icon": "Brain", "color": "indigo", "modules": ["base"]}',
 12, true),

('gastroenterology', 'specialty',
 '{"es": {"name": "Gastroenterología", "description": "Sistema digestivo"},
   "fr": {"name": "Gastro-entérologie", "description": "Système digestif"},
   "en": {"name": "Gastroenterology", "description": "Digestive system"}}',
 '{"icon": "Activity", "color": "amber", "modules": ["base"]}',
 13, true),

('urology', 'specialty',
 '{"es": {"name": "Urología", "description": "Sistema urinario"},
   "fr": {"name": "Urologie", "description": "Système urinaire"},
   "en": {"name": "Urology", "description": "Urinary system"}}',
 '{"icon": "Droplet", "color": "yellow", "modules": ["base"]}',
 14, true),

('endocrinology', 'specialty',
 '{"es": {"name": "Endocrinología", "description": "Sistema endocrino y hormonas"},
   "fr": {"name": "Endocrinologie", "description": "Système endocrinien et hormones"},
   "en": {"name": "Endocrinology", "description": "Endocrine system and hormones"}}',
 '{"icon": "Activity", "color": "fuchsia", "modules": ["base", "chronic"]}',
 15, true),

('rheumatology', 'specialty',
 '{"es": {"name": "Reumatología", "description": "Enfermedades reumáticas"},
   "fr": {"name": "Rhumatologie", "description": "Maladies rhumatismales"},
   "en": {"name": "Rheumatology", "description": "Rheumatic diseases"}}',
 '{"icon": "Bone", "color": "stone", "modules": ["base", "chronic"]}',
 16, true),

('pneumology', 'specialty',
 '{"es": {"name": "Neumología", "description": "Sistema respiratorio"},
   "fr": {"name": "Pneumologie", "description": "Système respiratoire"},
   "en": {"name": "Pneumology", "description": "Respiratory system"}}',
 '{"icon": "Wind", "color": "sky", "modules": ["base"]}',
 17, true),

('nephrology', 'specialty',
 '{"es": {"name": "Nefrología", "description": "Sistema renal"},
   "fr": {"name": "Néphrologie", "description": "Système rénal"},
   "en": {"name": "Nephrology", "description": "Renal system"}}',
 '{"icon": "Droplet", "color": "rose", "modules": ["base", "chronic"]}',
 18, true),

('oncology', 'specialty',
 '{"es": {"name": "Oncología", "description": "Tratamiento del cáncer"},
   "fr": {"name": "Oncologie", "description": "Traitement du cancer"},
   "en": {"name": "Oncology", "description": "Cancer treatment"}}',
 '{"icon": "Target", "color": "red", "modules": ["base"]}',
 19, true),

('anesthesiology', 'specialty',
 '{"es": {"name": "Anestesiología", "description": "Anestesia y cuidados perioperatorios"},
   "fr": {"name": "Anesthésiologie", "description": "Anesthésie et soins périopératoires"},
   "en": {"name": "Anesthesiology", "description": "Anesthesia and perioperative care"}}',
 '{"icon": "Moon", "color": "slate", "modules": ["base", "surgery"]}',
 20, true)

ON CONFLICT (category_type, code) DO UPDATE SET
    translations = EXCLUDED.translations,
    metadata = EXCLUDED.metadata,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    updated_at = NOW();


-- ============================================================================
-- DEPARTMENTS (15 departments)
-- ============================================================================

INSERT INTO system_categories (code, category_type, translations, metadata, sort_order, is_system)
VALUES
('direction', 'department',
 '{"es": {"name": "Dirección", "description": "Dirección y gestión"},
   "fr": {"name": "Direction", "description": "Direction et gestion"},
   "en": {"name": "Management", "description": "Management and leadership"}}',
 '{"icon": "Crown", "color": "amber"}',
 1, true),

('administration', 'department',
 '{"es": {"name": "Administración", "description": "Servicios administrativos"},
   "fr": {"name": "Administration", "description": "Services administratifs"},
   "en": {"name": "Administration", "description": "Administrative services"}}',
 '{"icon": "FileText", "color": "gray"}',
 2, true),

('general_medicine_dept', 'department',
 '{"es": {"name": "Medicina General", "description": "Departamento de medicina general"},
   "fr": {"name": "Médecine Générale", "description": "Département de médecine générale"},
   "en": {"name": "General Medicine", "description": "General medicine department"}}',
 '{"icon": "Stethoscope", "color": "blue"}',
 3, true),

('cardiology_dept', 'department',
 '{"es": {"name": "Cardiología", "description": "Departamento de cardiología"},
   "fr": {"name": "Cardiologie", "description": "Département de cardiologie"},
   "en": {"name": "Cardiology", "description": "Cardiology department"}}',
 '{"icon": "Heart", "color": "red"}',
 4, true),

('dermatology_dept', 'department',
 '{"es": {"name": "Dermatología", "description": "Departamento de dermatología"},
   "fr": {"name": "Dermatologie", "description": "Département de dermatologie"},
   "en": {"name": "Dermatology", "description": "Dermatology department"}}',
 '{"icon": "Scan", "color": "orange"}',
 5, true),

('gynecology_dept', 'department',
 '{"es": {"name": "Ginecología", "description": "Departamento de ginecología"},
   "fr": {"name": "Gynécologie", "description": "Département de gynécologie"},
   "en": {"name": "Gynecology", "description": "Gynecology department"}}',
 '{"icon": "Users", "color": "purple"}',
 6, true),

('pediatrics_dept', 'department',
 '{"es": {"name": "Pediatría", "description": "Departamento de pediatría"},
   "fr": {"name": "Pédiatrie", "description": "Département de pédiatrie"},
   "en": {"name": "Pediatrics", "description": "Pediatrics department"}}',
 '{"icon": "Baby", "color": "pink"}',
 7, true),

('radiology_dept', 'department',
 '{"es": {"name": "Radiología", "description": "Departamento de radiología"},
   "fr": {"name": "Radiologie", "description": "Département de radiologie"},
   "en": {"name": "Radiology", "description": "Radiology department"}}',
 '{"icon": "Scan", "color": "indigo"}',
 8, true),

('surgery_dept', 'department',
 '{"es": {"name": "Cirugía", "description": "Departamento de cirugía"},
   "fr": {"name": "Chirurgie", "description": "Département de chirurgie"},
   "en": {"name": "Surgery", "description": "Surgery department"}}',
 '{"icon": "Scissors", "color": "red"}',
 9, true),

('nursing_dept', 'department',
 '{"es": {"name": "Enfermería", "description": "Departamento de enfermería"},
   "fr": {"name": "Soins infirmiers", "description": "Département de soins infirmiers"},
   "en": {"name": "Nursing", "description": "Nursing department"}}',
 '{"icon": "Activity", "color": "green"}',
 10, true),

('reception', 'department',
 '{"es": {"name": "Recepción", "description": "Recepción y atención al paciente"},
   "fr": {"name": "Accueil", "description": "Accueil et réception des patients"},
   "en": {"name": "Reception", "description": "Patient reception and welcome"}}',
 '{"icon": "UserCheck", "color": "cyan"}',
 11, true),

('pharmacy', 'department',
 '{"es": {"name": "Farmacia", "description": "Servicios de farmacia"},
   "fr": {"name": "Pharmacie", "description": "Services de pharmacie"},
   "en": {"name": "Pharmacy", "description": "Pharmacy services"}}',
 '{"icon": "Pill", "color": "emerald"}',
 12, true),

('laboratory', 'department',
 '{"es": {"name": "Laboratorio", "description": "Análisis y laboratorio clínico"},
   "fr": {"name": "Laboratoire", "description": "Analyses et laboratoire clinique"},
   "en": {"name": "Laboratory", "description": "Clinical analysis and laboratory"}}',
 '{"icon": "FlaskConical", "color": "violet"}',
 13, true),

('physiotherapy_dept', 'department',
 '{"es": {"name": "Fisioterapia", "description": "Departamento de fisioterapia"},
   "fr": {"name": "Kinésithérapie", "description": "Département de kinésithérapie"},
   "en": {"name": "Physiotherapy", "description": "Physiotherapy department"}}',
 '{"icon": "Activity", "color": "lime"}',
 14, true),

('audit', 'department',
 '{"es": {"name": "Auditoría", "description": "Control de calidad y auditoría"},
   "fr": {"name": "Audit", "description": "Contrôle qualité et audit"},
   "en": {"name": "Audit", "description": "Quality control and audit"}}',
 '{"icon": "ClipboardCheck", "color": "slate"}',
 15, true)

ON CONFLICT (category_type, code) DO UPDATE SET
    translations = EXCLUDED.translations,
    metadata = EXCLUDED.metadata,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    updated_at = NOW();


-- ============================================================================
-- APPOINTMENT PRIORITIES (4 priorities)
-- ============================================================================

INSERT INTO system_categories (code, category_type, translations, metadata, sort_order, is_system)
VALUES
('low', 'priority',
 '{"es": {"name": "Baja", "description": "Prioridad baja"},
   "fr": {"name": "Basse", "description": "Priorité basse"},
   "en": {"name": "Low", "description": "Low priority"}}',
 '{"color": "gray", "icon": "ArrowDown"}',
 1, true),

('normal', 'priority',
 '{"es": {"name": "Normal", "description": "Prioridad normal"},
   "fr": {"name": "Normale", "description": "Priorité normale"},
   "en": {"name": "Normal", "description": "Normal priority"}}',
 '{"color": "blue", "icon": "Minus"}',
 2, true),

('high', 'priority',
 '{"es": {"name": "Alta", "description": "Prioridad alta"},
   "fr": {"name": "Haute", "description": "Priorité haute"},
   "en": {"name": "High", "description": "High priority"}}',
 '{"color": "orange", "icon": "ArrowUp"}',
 3, true),

('urgent', 'priority',
 '{"es": {"name": "Urgente", "description": "Prioridad urgente"},
   "fr": {"name": "Urgente", "description": "Priorité urgente"},
   "en": {"name": "Urgent", "description": "Urgent priority"}}',
 '{"color": "red", "icon": "AlertTriangle"}',
 4, true)

ON CONFLICT (category_type, code) DO UPDATE SET
    translations = EXCLUDED.translations,
    metadata = EXCLUDED.metadata,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    updated_at = NOW();
