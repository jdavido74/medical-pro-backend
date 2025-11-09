# 🏥 Plan d'Implémentation MedicalPro - Backend

Basé sur clarifications utilisateur et architecture factorée.

---

## 📋 **Modèles à Créer**

### **1. Practitioner** (User qui fait les RDV)
```javascript
Practitioner {
  id (UUID, PK)
  company_id (FK → Company, multi-tenant)
  user_id (FK → User, le praticien qui login)

  // Infos médicales
  license_number (STRING, UNIQUE per company)
  license_expiry (DATE)
  speciality (ARRAY/JSONB: ['dentiste', 'kiné', ...])
  bio (TEXT)
  photo_url (STRING)

  // Availability
  working_hours (JSONB: { monday: { start: '09:00', end: '18:00' }, ... })

  // Status
  is_active (BOOLEAN)
  deleted_at (soft delete)

  timestamps
}
```

**Relations:**
- `Practitioner → User` (1:1, créé automatiquement)
- `Practitioner → Appointment` (1:N, le praticien fait l'appointment)

---

### **2. Appointment** (Rendez-vous)
```javascript
Appointment {
  id (UUID, PK)
  company_id (FK → Company)
  patient_id (FK → Patient)
  practitioner_id (FK → Practitioner)

  // Timing
  start_time (DATETIME)
  end_time (DATETIME)

  // Content
  reason (STRING: "Détartrage", "Consultation", ...)
  notes (JSONB: notes du praticien)

  // Status
  status (ENUM: scheduled, confirmed, cancelled, completed, no-show)

  // Quote draft
  quote_id (FK → Quote, nullable, le devis draft généré de ce RDV)

  deleted_at (soft delete)
  timestamps
}
```

**Relations:**
- `Appointment → Patient` (N:1)
- `Appointment → Practitioner` (N:1)
- `Appointment → Quote` (1:1, devis draft)
- `Appointment → AppointmentItem` (1:N, produits/services)

---

### **3. AppointmentItem** (Produits/Services du RDV) ⭐ NEW
```javascript
AppointmentItem {
  id (UUID, PK)
  company_id (FK → Company)
  appointment_id (FK → Appointment)
  product_service_id (FK → ProductService)

  // Pricing
  quantity (DECIMAL: 1, 2, 0.5, ...)
  unit_price (DECIMAL: prix au moment du RDV, peut différer du catalogue)

  // Line total
  total (DECIMAL: quantity * unit_price)

  // Patient acceptance
  status (ENUM: proposed, accepted, refused, completed)

  // Notes
  notes (TEXT)

  deleted_at (soft delete)
  timestamps
}
```

**Relations:**
- `AppointmentItem → Appointment` (N:1)
- `AppointmentItem → ProductService` (N:1)

---

### **4. DocumentBase** (Abstraction Quote/Invoice) ⭐ FACTORIZATION
```javascript
// Au lieu de dupliquer Quote et Invoice
// Créer une table abstraite commune

DocumentBase {
  id (UUID, PK)
  company_id (FK)
  patient_id (FK → Patient)
  appointment_id (FK → Appointment, nullable)
  practitioner_id (FK → Practitioner, nullable)

  // Type: quote ou invoice
  document_type (ENUM: quote, invoice)

  // Numbering
  document_number (STRING: "DV-2024-001" ou "FA-2024-001")

  // Dates
  issue_date (DATE)
  due_date (DATE, nullable pour devis)

  // Items
  items (JSONB: snapshot des AppointmentItems ou items manuels)

  // Totals
  subtotal (DECIMAL)
  tax_amount (DECIMAL)
  total (DECIMAL)

  // Status
  status (ENUM: draft, sent, accepted, rejected, paid, cancelled)

  // Tracking
  sent_at (DATETIME, quand envoyé au patient)
  accepted_at (DATETIME, quand patient accepte)

  deleted_at (soft delete)
  timestamps
}
```

**Relations:**
- `DocumentBase → Patient` (N:1)
- `DocumentBase → Appointment` (N:1)
- `DocumentBase → Practitioner` (N:1)

---

### **5. Consent** (Consentements médicaux)
```javascript
Consent {
  id (UUID, PK)
  company_id (FK)
  patient_id (FK → Patient)
  appointment_id (FK → Appointment, nullable)
  product_service_id (FK → ProductService, nullable)

  // Type
  consent_type (ENUM: medical_treatment, data_processing, photo, communication)

  // Template
  consent_template_id (FK → ConsentTemplate, nullable)

  // Content
  title (STRING)
  description (TEXT)
  terms (TEXT: conditions détaillées)

  // Status
  status (ENUM: pending, accepted, rejected)

  // Signature électronique
  signed_at (DATETIME, quand signé)
  signature_method (ENUM: digital, checkbox, pin)
  ip_address (STRING: IP patient)
  device_info (JSONB: user agent, browser, etc)

  // References
  related_document_id (FK, nullable: devis/facture lié)

  deleted_at (soft delete)
  timestamps
}
```

**Relations:**
- `Consent → Patient` (N:1)
- `Consent → Appointment` (N:1)
- `Consent → ProductService` (N:1)
- `Consent → ConsentTemplate` (N:1)

---

### **6. ConsentTemplate** (Templates réutilisables)
```javascript
ConsentTemplate {
  id (UUID, PK)
  company_id (FK)

  // Identifiant
  code (STRING, UNIQUE per company: "GDPR-2024", "PHOTO-2024")
  title (STRING)
  description (TEXT)

  // Content
  terms (TEXT: conditions standard)
  version (STRING: "1.0", "2.0", pour tracking évolutions)

  // Configuration
  consent_type (ENUM)
  is_mandatory (BOOLEAN)
  auto_send (BOOLEAN: envoyer auto quand devis généré?)

  // Validity
  valid_from (DATE)
  valid_until (DATE, nullable: sans limite)

  deleted_at (soft delete)
  timestamps
}
```

---

## 🔄 **Flux: Créer Appointment avec Products/Services**

### **Étape 1: Créer l'Appointment**
```javascript
POST /api/v1/appointments
{
  patient_id: "p-123",
  practitioner_id: "doc-456",
  start_time: "2024-11-20T10:00:00Z",
  end_time: "2024-11-20T10:30:00Z",
  reason: "Détartrage"
}
// Response: appointment créé, id: "apt-789"
```

### **Étape 2: Ajouter des Products/Services**
```javascript
POST /api/v1/appointments/apt-789/items
[
  {
    product_service_id: "prod-1",
    quantity: 1,
    unit_price: 50.00  // peut différer du catalogue
  },
  {
    product_service_id: "prod-2",
    quantity: 2,
    unit_price: 25.00
  }
]
// Response: AppointmentItems créés
```

### **Étape 3: Générer Draft Devis** (optionnel, peut être auto)
```javascript
POST /api/v1/appointments/apt-789/quote-draft
{
  send_to_patient: false  // vrai si envoyer immédiatement
}
// Response: DocumentBase créé, type: "quote", status: "draft"
```

### **Étape 4: Envoyer Devis au Patient** (optionnel)
```javascript
PATCH /api/v1/documents/doc-123
{
  status: "sent",
  send_email: true
}
// Response: sent_at mis à jour, email envoyé
```

### **Étape 5: Patient Accepte/Refuse**
```javascript
PATCH /api/v1/documents/doc-123
{
  status: "accepted"  // ou "rejected"
}
// Response: accepted_at mis à jour
```

### **Étape 6: Générer Facture**
```javascript
POST /api/v1/documents/doc-123/convert-to-invoice
{
  issue_date: "2024-11-20",
  due_date: "2024-12-20"
}
// Response: Nouvelle DocumentBase créée, type: "invoice"
// OU from scratch:

POST /api/v1/documents
{
  document_type: "invoice",
  patient_id: "p-123",
  appointment_id: "apt-789",  // optionnel
  items: [...],  // items manuels ou depuis appointment
  issue_date: "2024-11-20",
  due_date: "2024-12-20"
}
```

---

## 🔐 **Flux: Consentements**

### **Scénario 1: Consentements Auto (quand devis envoyé)**

```javascript
// Quand on envoie un devis:
POST /api/v1/documents/doc-123/send
{
  send_consents: true  // envoyer aussi les consentements requis
}

// Backend:
// 1. Récupérer les AppointmentItems du devis
// 2. Pour chaque item, regarder les ConsentsTemplates liées
// 3. Créer des Consent en status "pending"
// 4. Envoyer email: "Devis + Consentements à signer"
```

### **Scénario 2: Patient Signe un Consentement**

```javascript
PATCH /api/v1/consents/consent-123
{
  status: "accepted",
  signature_method: "digital"  // ou "checkbox"
}
// Response:
// - status: "accepted"
// - signed_at: NOW()
// - ip_address: "192.168.1.1"
// - device_info: { userAgent: "...", ... }
```

### **Scénario 3: Historique Consentements**

```javascript
GET /api/v1/patients/p-123/consents
// Response: tous les consentements du patient (pending, accepted, rejected)

GET /api/v1/appointments/apt-789/consents
// Response: consentements liés à ce RDV
```

---

## 🎯 **Rôles & Permissions**

### **Rôles Actuels (à adapter)**

```javascript
// src/models/User.js
const defaultPermissions = {
  super_admin: {
    // Peut tout faire, toutes les cliniques
    dashboard: { read: true, write: true },
    companies: { read: true, write: true, delete: true },
    users: { read: true, write: true, delete: true },
    // ...medical...
    patients: { read: true, write: true, delete: true },
    appointments: { read: true, write: true, delete: true },
    documents: { read: true, write: true, delete: true },
    consents: { read: true, write: true, delete: true }
  },

  admin: {
    // Gère la clinique
    dashboard: { read: true, write: true },
    users: { read: true, write: true, delete: true },
    patients: { read: true, write: true, delete: true },
    appointments: { read: true, write: true, delete: true },
    documents: { read: true, write: true, delete: true },
    consents: { read: true, write: true, delete: true },
    analytics: { read: true, write: false }
  },

  doctor_or_practitioner: {  // Renommer "user"
    // Fait les RDV
    dashboard: { read: true, write: false },
    appointments: { read: true, write: true, delete: false },  // crée/modifie ses RDV
    patients: { read: true, write: true, delete: false },
    documents: { read: true, write: true, delete: false },  // crée devis
    consents: { read: true, write: false, delete: false }  // voit consentements
  },

  secretary: {
    // Gère l'agenda, les devis, factures
    dashboard: { read: true, write: false },
    appointments: { read: true, write: true, delete: true },  // gère l'agenda
    patients: { read: true, write: true, delete: false },
    documents: { read: true, write: true, delete: true },  // crée/modifie devis/factures
    consents: { read: true, write: false, delete: false }
  },

  readonly: {
    // Consultation seulement
    dashboard: { read: true, write: false },
    appointments: { read: true, write: false, delete: false },
    patients: { read: true, write: false, delete: false },
    documents: { read: true, write: false, delete: false },
    consents: { read: true, write: false, delete: false }
  }
};
```

### **Règles Métier**

```javascript
// Permissions spécifiques
- Doctor/Practitioner peut créer/modifier appointmentItems dans SES RDV seulement
- Secretary peut créer/modifier appointmentItems dans N'IMPORTE QUEL RDV
- Doctor/Practitioner peut créer draft devis mais Secretary envoie
- Doctor/Practitioner peut voir consentements mais pas les modifier
- Patient reçoit consentements par email (futur: portal)
```

---

## 📅 **Ordre d'Implémentation**

### **Phase 1: Modèles (3-4h)**
1. ✅ Practitioner model + migration SQL
2. ✅ Appointment model + migration SQL
3. ✅ AppointmentItem model + migration SQL
4. ✅ DocumentBase model + migration SQL (factorisation Quote/Invoice)
5. ✅ Consent + ConsentTemplate models + migration SQL

### **Phase 2: Routes CRUD (2-3h avec crudRoutes factory)**
1. ✅ POST/GET/PUT/DELETE /practitioners
2. ✅ POST/GET/PUT/DELETE /appointments
3. ✅ POST/GET/PUT/DELETE /appointments/:id/items
4. ✅ POST/GET/PUT/DELETE /documents
5. ✅ POST/GET /documents/:id/convert-to-invoice (quote → invoice)
6. ✅ PATCH /documents/:id/send (envoyer au patient)
7. ✅ POST/GET/PUT /consents
8. ✅ PATCH /consents/:id (signer)

### **Phase 3: Associations & Relations (1h)**
1. ✅ Practitioner ↔ User (create user auto)
2. ✅ Appointment ↔ Practitioner/Patient
3. ✅ AppointmentItem ↔ Appointment/ProductService
4. ✅ DocumentBase ↔ Patient/Appointment
5. ✅ Consent ↔ Patient/Appointment/ProductService

### **Phase 4: Adapters & Business Logic (2-3h)**
1. ✅ Adapter Quote/Invoice vers DocumentBase
2. ✅ Auto-generate document_number
3. ✅ Auto-generate appointment quote draft
4. ✅ Auto-send consents quand devis envoyé
5. ✅ Tracker signatures électroniques

### **Phase 5: Frontend Migration (3-5h)**
1. PatientContext → API
2. AppointmentContext → API
3. Refactor AppointmentFormModal
4. Refactor QuoteModal
5. Refactor ConsentModal

---

## 💾 **Changements Quote/Invoice (Factorisation)**

### **Avant** (Code dupliqué)
```
Quote.js (300 lignes)
Invoice.js (300 lignes)
Total: 600 lignes de duplication
```

### **Après** (Factorisation)
```
DocumentBase.js (100 lignes)
routes/documents.js (avec crudRoutes, 50 lignes)
Migrations: single table "documents" avec document_type discriminant

Total: 150 lignes
```

### **Benefits**
✅ Zéro duplication
✅ Un seul CRUD à maintenir
✅ Conversion quote→invoice = simple UPDATE
✅ Single source of truth

---

## 🧪 **Testing Checklist**

- [ ] Créer Appointment + AppointmentItems
- [ ] Générer Quote draft automatiquement
- [ ] Envoyer Quote au patient
- [ ] Patient accepte Quote
- [ ] Convertir Quote → Invoice
- [ ] Créer Consentements auto
- [ ] Patient signe Consentement (électroniquement)
- [ ] Historique signatures (IP, device, timestamp)
- [ ] Permissions: Doctor crée items dans ses RDV seulement
- [ ] Permissions: Secretary gère tous les RDV/documents
- [ ] Offline: Queue mutations (appoinment, document, consent)
- [ ] Synchronité: User voit changes IMMÉDIATEMENT

---

## 📊 **Modèles Finaux (Resume)**

| Modèle | Purpose | Factorisation |
|--------|---------|----------------|
| Practitioner | Praticien qui fait RDV | BaseModel ✅ |
| Appointment | RDV | BaseModel ✅ |
| AppointmentItem | Produits/Services du RDV | BaseModel ✅ |
| DocumentBase | Quote + Invoice combinés | BaseModel ✅ |
| Consent | Consentements signés | BaseModel ✅ |
| ConsentTemplate | Templates consentements | BaseModel ✅ |

**Total code: ~400 lignes** vs **~2000 lignes** sans factorisation.

---

## ⚡ **Commencer?**

Tout est prêt. À votre signal, je crée:
1. 5 migrations SQL
2. 5 modèles Sequelize
3. Routes CRUD automatiques
4. Tests

**Validation finale:**
- ✅ Rôles: super_admin, admin, doctor/practitioner, secretary, readonly?
- ✅ Consentements: auto-envoyé quand devis envoyé?
- ✅ Signature électronique: tracker IP + device?
- ✅ AppointmentItems: status indépendant (accepted/refused par item)?

🚀
