# 🔐 Protection des Comptes Super Admin

## Vue d'ensemble

Les comptes **super_admin** sont protégés contre la suppression et les modifications via l'API REST. Ils ne peuvent être modifiés ou supprimés que **directement en base de données**.

---

## 🛡️ Protections Mises en Place

### 1. **Protection contre la suppression de company**

Quand on essaie de supprimer une company qui contient un super_admin:

**Réponse API (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "message": "Cannot delete company with super_admin users",
    "details": "Cette company contient X super_admin(s) et ne peut pas être supprimée...",
    "superAdmins": [
      { "id": "xxx", "email": "superadmin@medicalpro.com" }
    ]
  }
}
```

### 2. **Protection contre la désactivation de company**

Quand on essaie de désactiver (soft delete) une company avec super_admin:

**Réponse API (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "message": "Cannot deactivate company with super_admin users",
    "details": "Les super_admin doivent être supprimés directement en base de données avant..."
  }
}
```

### 3. **Protection contre la modification du rôle**

Quand on essaie de changer le rôle d'un super_admin:

**Réponse API (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "message": "Cannot modify super_admin role",
    "details": "Le rôle des comptes super_admin ne peut pas être modifié via l'API..."
  }
}
```

### 4. **Protection contre la désactivation**

Quand on essaie de désactiver un super_admin:

**Réponse API (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "message": "Cannot deactivate super_admin account",
    "details": "Les comptes super_admin ne peuvent pas être désactivés via l'API..."
  }
}
```

---

## 🔓 Gestion Directe en Base de Données

Pour modifier ou supprimer un super_admin, il faut accéder **directement à PostgreSQL**.

### ✅ Lister tous les super_admin:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT id, email, first_name, last_name, is_active, created_at 
FROM users 
WHERE role = 'super_admin';
"
```

### ❌ Supprimer un super_admin:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
DELETE FROM users 
WHERE id = '<user_id>' AND role = 'super_admin';
"
```

### 🔄 Désactiver un super_admin:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
UPDATE users 
SET is_active = false 
WHERE id = '<user_id>' AND role = 'super_admin';
"
```

### 🔐 Changer le rôle d'un super_admin (démotion):

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
UPDATE users 
SET role = 'admin' 
WHERE id = '<user_id>' AND role = 'super_admin';
"
```

---

## 📋 Exemple Complet

### Trouver l'ID du super_admin:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT id, email FROM users WHERE email = 'superadmin@medicalpro.com';
"
```

**Résultat:**
```
                  id                  |            email
--------------------------------------+------------------------------
 6fd45b36-eda7-4d86-b7f4-34bfc5a8f119 | superadmin@medicalpro.com
```

### Supprimer le compte:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
DELETE FROM users 
WHERE id = '6fd45b36-eda7-4d86-b7f4-34bfc5a8f119';
"
```

### Vérifier la suppression:

```bash
PGPASSWORD=medicalpro2024 psql -h localhost -U medicalpro -d medicalpro_central -c "
SELECT COUNT(*) FROM users WHERE role = 'super_admin';
"
```

---

## 🔔 Audit et Logs

Tous les tentatives de suppression/modification des super_admin via l'API sont **loggées**:

```bash
# Voir les logs du backend
tail -f /tmp/medicalpro-backend.log | grep -i "super_admin\|Cannot"
```

---

## ⚠️ Important

- ✅ Les super_admin ne peuvent **pas** être supprimés via l'API
- ✅ Les super_admin ne peuvent **pas** être désactivés via l'API
- ✅ Le rôle des super_admin ne peut **pas** être modifié via l'API
- ✅ Les companies avec super_admin ne peuvent **pas** être supprimées/désactivées

**Seul un administrateur de base de données peut effectuer ces opérations.**

