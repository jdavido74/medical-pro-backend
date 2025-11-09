# 🔐 Compliance RGPD - Signatures Électroniques

## Réglementation Applicable

**Article 32 RGPD**: Intégrité et confidentialité des données via signature électronique
**eIDAS Regulation (EU 910/2014)**: Signatures électroniques valides légalement

---

## ✅ Implémentation Conforme

### **1. Consentement explicite**

```javascript
Consent {
  // Avant signature
  status: "pending"

  // Après signature
  status: "accepted"
  signed_at: "2024-11-09T12:30:00Z"  // Preuve de timing
}
```

**RGPD**: ✅ Consentement explicite documenté + timestamp

---

### **2. Traçabilité complète**

```javascript
Consent {
  signed_at: "2024-11-09T12:30:00Z",
  signature_method: "digital" | "checkbox",

  // Preuve d'identité du patient
  ip_address: "192.168.1.100",
  device_info: {
    userAgent: "Mozilla/5.0...",
    platform: "Linux",
    timezone: "Europe/Paris",
    fingerprint: "hash_device_unique" // Optional
  },

  // Consentement lié
  related_content: {
    consent_template_id: "...",
    appointment_id: "...",
    version: "1.0"
  }
}
```

**RGPD Article 12**: ✅ Preuve de qui a signé, quand, comment, depuis où
**eIDAS**: ✅ Signature valide légalement (authentication + integrity)

---

### **3. Droit à l'oubli (Soft Delete)**

```javascript
Consent {
  deleted_at: null,  // Actif
  // OU
  deleted_at: "2025-01-15T00:00:00Z"  // Soft delete, pas suppression réelle
}
```

**RGPD Article 17**: ✅ Soft delete permet audit trail (historique)
**RGPD Article 5**: ✅ Stockage limité dans le temps (peut configurer TTL)

---

### **4. Données minimales**

```javascript
// ✅ COLLECTÉES
signed_at         // Quand
signature_method  // Comment (digital/checkbox)
ip_address        // Où (géolocalisation optionnelle)
device_info       // Quel device

// ❌ NON COLLECTÉES (sensible data)
// Pas de password, pas de numéro carte, pas de SSN
// (déjà chiffré ailleurs)
```

**RGPD Article 5**: ✅ Minimisation des données

---

### **5. Sécurité du stockage**

```javascript
// Base de données
- PostgreSQL avec encryption au repos (pgcrypto)
- Backup chiffré
- Accès limité par roles DB

// Application
- HTTPS obligatoire (TLS 1.3+)
- Rate limiting contre bruteforce
- Session timeout court (15min)
- Audit logging complet

// Code
- Pas de signatures en plaintext en logs
- Hashing des device fingerprints
```

**RGPD Article 32**: ✅ Sécurité renforcée

---

### **6. Droit d'accès**

```javascript
GET /api/v1/patients/:id/consents
// Patient peut voir TOUS ses consentements signés
// Avec timestamps, IP, device (pour preuve)

GET /api/v1/patients/:id/consents/:consent_id
// Détails complets d'une signature
```

**RGPD Article 15**: ✅ Patient peut vérifier ses données

---

### **7. Rectification & Opposition**

```javascript
// Patient peut refuser un consentement (new)
PATCH /api/v1/consents/:consent_id
{
  status: "rejected"
}

// Audit trail conservé (soft delete)
// Preuve historique: "Patient a accepté le 09/11, refusé le 10/11"
```

**RGPD Articles 16, 21**: ✅ Droit de rectification & opposition

---

## 📋 Checklist RGPD

- [ ] Consentement explicite documenté ✅
- [ ] Timestamp de chaque signature ✅
- [ ] Preuve d'identité (IP + device) ✅
- [ ] Encryption en transit (HTTPS) ✅
- [ ] Encryption au repos (pgcrypto) ✅
- [ ] Soft delete (pas vraie suppression) ✅
- [ ] Audit trail complet ✅
- [ ] Droit d'accès (GET /consents) ✅
- [ ] Droit de refus (PATCH status) ✅
- [ ] Politique de rétention (TTL configurable) ✅

---

## 🔒 Implémentation Séculité (En Plus)

### **Option 1: Hash Device (Recommandé)**

```javascript
// Frontend
const deviceFingerprint = await getDeviceFingerprint();
// Combine: User Agent + Screen Resolution + Timezone + etc

// Backend reçoit fingerprint hasé
device_info: {
  userAgent: "Mozilla/5.0...",
  fingerprint_hash: "sha256(..."  // Pas le vrai fingerprint
}
```

**Avantage**: Impossible de récupérer le device, juste prouver cohérence

---

### **Option 2: Geolocation (Optionnel)**

```javascript
// Optionnel: géolocalisation depuis IP
ip_address: "192.168.1.100",
geolocation: {
  city: "Paris",
  country: "FR",
  coordinates: { lat: 48.8566, lon: 2.3522 }  // Approximatif
}
```

**Attention**: RGPD exige consentement pour geoloc (circular! 🔄)
Mieux: Garder IP seulement, pas de géoloc.

---

## 📝 Documentation Patient

**À afficher avant signature:**

```
🔒 Informations de Sécurité

Votre consentement sera signé électroniquement et conservé dans nos serveurs sécurisés.

Nous enregistrerons:
- La date et l'heure exacte: 09/11/2024 12:30:00 UTC
- Votre adresse IP pour sécurité: 192.168.1.100
- Votre navigateur et appareil pour audit

Vos droits:
✅ Accès: Vous pouvez voir tous vos consentements signés
✅ Rectification: Vous pouvez demander une correction
✅ Opposition: Vous pouvez retirer un consentement
✅ Suppression: Vous pouvez demander l'effacement (droit à l'oubli)

Plus d'infos: [Lien politique de confidentialité]
Contactez: privacy@clinic.fr
```

---

## ✅ Conclusion

**L'implémentation est RGPD-compliant** si:

1. ✅ Signatures avec timestamp + IP + device
2. ✅ Soft delete (audit trail conservé)
3. ✅ HTTPS obligatoire
4. ✅ Encryption au repos
5. ✅ Patient peut accéder/refuser/demander suppression
6. ✅ Politique de confidentialité visible

**Recommandations additionnelles:**

- Ajouter un **Consentement Management Portal** pour patients (voir leurs signatures)
- Implémenter **Audit Logging** centralisé (qui a accédé à quel consentement)
- Configurer **Retention Policy** (garder signatures 10 ans minimum, médical)
- Tester **GDPR Data Export** (patient récupère tout ses données en JSON)

---

**Status: PRÊT À IMPLÉMENTER** ✅

Allez-y confiance, c'est RGPD-proof!
