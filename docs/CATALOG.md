# Catalogue Médical - Documentation Technique

## Vue d'ensemble

Le module Catalogue gère les produits, médicaments, traitements et services de la clinique. Il supporte un système de familles/variantes pour regrouper des produits similaires avec des dosages ou prix différents.

---

## Architecture

### Base de données

Le catalogue utilise une architecture multi-tenant avec des bases de données isolées par clinique.

#### Tables principales

```sql
-- Produits et services
products_services (
  id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(20),                    -- 'product' | 'service' (legacy)
  item_type VARCHAR(20),               -- 'product' | 'medication' | 'treatment' | 'service'
  unit_price DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'EUR',
  unit VARCHAR(50) DEFAULT 'unité',
  sku VARCHAR(100),
  tax_rate DECIMAL(5,2) DEFAULT 20.00,
  company_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,

  -- Champs médicaux
  duration INTEGER,                    -- Durée en minutes (services/traitements)
  prep_before INTEGER DEFAULT 0,       -- Temps de préparation avant (minutes)
  prep_after INTEGER DEFAULT 0,        -- Temps après traitement (minutes)
  dosage DECIMAL(10,2),               -- Quantité de dosage
  dosage_unit VARCHAR(10),            -- 'mg' | 'ml' | 'g' | 'ui' | 'mcg'
  volume DECIMAL(10,2),               -- Volume en ml
  provenance VARCHAR(200),            -- Origine/provenance
  is_overlappable BOOLEAN DEFAULT FALSE,
  machine_type_id UUID,               -- Référence vers type de machine

  -- Familles/Variantes
  parent_id UUID REFERENCES products_services(id),
  is_family BOOLEAN DEFAULT FALSE,
  is_variant BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Catégories
categories (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#3B82F6',
  type VARCHAR(50) NOT NULL,          -- 'medication' | 'treatment' | 'service' | 'product'
  sort_order INTEGER DEFAULT 0,
  company_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Tables de jonction (sans timestamps)
product_categories (
  id UUID PRIMARY KEY,
  product_service_id UUID REFERENCES products_services(id),
  category_id UUID REFERENCES categories(id),
  created_at TIMESTAMP,
  UNIQUE(product_service_id, category_id)
)

product_tags (
  id UUID PRIMARY KEY,
  product_service_id UUID REFERENCES products_services(id),
  tag_id UUID REFERENCES tags(id),
  created_at TIMESTAMP,
  UNIQUE(product_service_id, tag_id)
)
```

---

## Système de Familles/Variantes

### Concept

Une **famille** est un produit parent qui peut avoir plusieurs **variantes**. Les variantes héritent de certaines propriétés du parent.

```
Famille : Vitamine C (provenance: France, TVA: 5.5%)
  ├── Variante : Vitamine C 500mg - 12,50€
  ├── Variante : Vitamine C 1000mg - 18,00€
  └── Variante : Vitamine C 2000mg - 24,00€
```

### Cas d'utilisation

| Cas | Exemple |
|-----|---------|
| Dosages différents | Botox 50ui, 100ui, 200ui |
| Volumes différents | Acide hyaluronique 0.5ml, 1ml, 2ml |
| Conditionnements | Crème 50ml, 100ml, 200ml |
| Concentrations | Vitamine C 500mg, 1000mg, 2000mg |

### Structure en base de données

```
┌─────────────────────────────────────────────────────────────────┐
│ products_services                                                │
├─────────────────────────────────────────────────────────────────┤
│ id: "family-001"                                                 │
│ title: "Vitamine C"                                              │
│ is_family: TRUE        ◄── Marqué comme famille                  │
│ is_variant: FALSE                                                │
│ parent_id: NULL        ◄── Pas de parent (c'est le parent)       │
│ provenance: "France"                                             │
│ tax_rate: 5.50                                                   │
│ unit_price: 0.00       ◄── Prix à 0 (les variantes ont le prix)  │
├─────────────────────────────────────────────────────────────────┤
│ id: "variant-001"                                                │
│ title: "Vitamine C 500mg"                                        │
│ is_family: FALSE                                                 │
│ is_variant: TRUE       ◄── Marqué comme variante                 │
│ parent_id: "family-001" ◄── Référence vers le parent             │
│ provenance: NULL       ◄── Hérité du parent à l'affichage        │
│ tax_rate: NULL         ◄── Hérité du parent à l'affichage        │
│ unit_price: 12.50      ◄── Prix spécifique à la variante         │
│ dosage: 500                                                      │
│ dosage_unit: "mg"                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Champs hérités automatiquement

Lors de la création d'une variante, si non spécifié :

| Champ | Comportement |
|-------|--------------|
| `provenance` | Copié du parent |
| `tax_rate` | Copié du parent |
| `type` | Copié du parent |
| `item_type` | Copié du parent |
| `company_id` | Copié du parent |

### Types supportant les familles

Seuls certains types peuvent avoir des variantes :

```javascript
// catalogConfig.js
CATALOG_TYPES = {
  medication: { canHaveVariants: true },   // ✅ Supporte les variantes
  treatment: { canHaveVariants: true },    // ✅ Supporte les variantes
  service: { canHaveVariants: false },     // ❌ Pas de variantes
  product: { canHaveVariants: false }      // ❌ Pas de variantes
}
```

---

## Process Familles/Variantes

### Scénario 1 : Créer une famille depuis zéro

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CRÉATION DE LA FAMILLE                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend                        Backend                         │
│  ─────────                       ───────                         │
│  Formulaire CatalogFormModal     POST /api/v1/products           │
│  ┌──────────────────────┐                                        │
│  │ Titre: Vitamine C    │        {                               │
│  │ Type: medication     │          "title": "Vitamine C",        │
│  │ Prix: 0              │          "itemType": "medication",     │
│  │ ☑ Créer comme famille│          "unitPrice": 0,               │
│  │ Provenance: France   │          "isFamily": true,             │
│  │ TVA: 5.5%            │          "provenance": "France",       │
│  └──────────────────────┘          "taxRate": 5.5                │
│                                  }                               │
│                                                                  │
│  Résultat en DB:                                                 │
│  ┌──────────────────────────────────────────────┐                │
│  │ id: "abc-123"                                │                │
│  │ is_family: TRUE                              │                │
│  │ is_variant: FALSE                            │                │
│  │ parent_id: NULL                              │                │
│  └──────────────────────────────────────────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. AJOUT DES VARIANTES                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend                        Backend                         │
│  ─────────                       ───────                         │
│  Clic sur bouton "+"             POST /api/v1/products/abc-123/  │
│  (Ajouter variante)                   variants                   │
│  ┌──────────────────────┐                                        │
│  │ Titre: Vit C 500mg   │        {                               │
│  │ Prix: 12.50€         │          "title": "Vitamine C 500mg",  │
│  │ Dosage: 500 mg       │          "unitPrice": 12.50,           │
│  └──────────────────────┘          "dosage": 500,                │
│                                    "dosageUnit": "mg"            │
│                                  }                               │
│                                                                  │
│  Backend ajoute automatiquement:                                 │
│  - parent_id = "abc-123"                                         │
│  - is_variant = true                                             │
│  - is_family = false                                             │
│  - type = parent.type                                            │
│  - item_type = parent.item_type                                  │
│  - provenance = parent.provenance (si non fourni)                │
│  - tax_rate = parent.tax_rate (si non fourni)                    │
│  - company_id = user.companyId                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Scénario 2 : Convertir un produit existant en famille

```
┌─────────────────────────────────────────────────────────────────┐
│ AVANT : Produit simple                                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐                │
│  │ id: "xyz-789"                                │                │
│  │ title: "Botox"                               │                │
│  │ is_family: FALSE                             │                │
│  │ is_variant: FALSE                            │                │
│  │ parent_id: NULL                              │                │
│  │ unit_price: 150.00                           │                │
│  └──────────────────────────────────────────────┘                │
│                                                                  │
│  Actions disponibles: [Éditer] [Dupliquer] [Convertir] [Suppr]   │
│                                            ▲                     │
│                                            │                     │
│                            Bouton visible car:                   │
│                            - !isFamily && !isVariant             │
│                            - itemType permet les variantes       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ACTION : Clic sur "Convertir en famille"                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend                        Backend                         │
│  ─────────                       ───────                         │
│  catalogStorage                  PUT /api/v1/products/xyz-789    │
│    .convertToFamily("xyz-789")                                   │
│                                  { "isFamily": true }            │
│                                                                  │
│  Transformation en DB:                                           │
│  - is_family: FALSE → TRUE                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ APRÈS : Famille sans variantes (encore)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐                │
│  │ id: "xyz-789"                                │                │
│  │ title: "Botox"                               │                │
│  │ is_family: TRUE  ◄── Changé                  │                │
│  │ is_variant: FALSE                            │                │
│  │ parent_id: NULL                              │                │
│  │ unit_price: 150.00                           │                │
│  └──────────────────────────────────────────────┘                │
│                                                                  │
│  Actions disponibles: [Éditer] [Dupliquer] [+ Variante] [Suppr]  │
│                                            ▲                     │
│                                            │                     │
│                            Nouveau bouton car isFamily=true      │
│                                                                  │
│  L'utilisateur peut maintenant ajouter des variantes             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Scénario 3 : Affichage dans la liste

```
┌─────────────────────────────────────────────────────────────────┐
│ LISTE DU CATALOGUE                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Filtres ─────────────────────────────────────────────────┐   │
│  │ [Tous] [Médicaments] [Traitements] [Services]             │   │
│  │ ☐ Afficher les inactifs                                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Tableau ─────────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │  ▼ Vitamine C          medication   France    -      5.5% │   │
│  │    └─ Vit C 500mg      medication   (hérité)  12.50€ 5.5% │   │
│  │    └─ Vit C 1000mg     medication   (hérité)  18.00€ 5.5% │   │
│  │    └─ Vit C 2000mg     medication   (hérité)  24.00€ 5.5% │   │
│  │                                                           │   │
│  │  ▶ Botox               treatment    USA       -      20%  │   │
│  │     (3 variantes - cliquer pour déplier)                  │   │
│  │                                                           │   │
│  │    Consultation        service      -         80.00€ 20%  │   │
│  │     (produit simple - pas de variantes)                   │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Logique d'affichage:                                            │
│  - Les variantes (isVariant=true) sont masquées au niveau root   │
│  - Elles apparaissent sous leur parent quand la famille est      │
│    dépliée (expandedFamilies.has(parent.id))                     │
│  - Les familles ont un chevron ▶/▼ pour déplier/replier          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Code Backend : Création de variante

```javascript
// POST /products/:id/variants
router.post('/:id/variants', async (req, res) => {
  const { id } = req.params;  // ID du parent

  // 1. Récupérer le parent
  const ProductService = await getModel(req.clinicDb, 'ProductService');
  const parent = await ProductService.findByPk(id);

  if (!parent) {
    return res.status(404).json({ error: 'Parent not found' });
  }

  // 2. Valider les données de la variante
  const { error, value } = variantSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details });
  }

  // 3. Préparer les données de la variante
  const variantData = transformToDb(value);
  variantData.parent_id = id;           // Lien vers parent
  variantData.is_variant = true;        // Marquer comme variante
  variantData.is_family = false;        // Pas une famille
  variantData.type = parent.type;       // Copier le type
  variantData.item_type = parent.item_type;
  variantData.company_id = req.user.companyId;

  // 4. Héritage des champs optionnels
  if (!variantData.provenance) {
    variantData.provenance = parent.provenance;
  }
  if (!variantData.tax_rate) {
    variantData.tax_rate = parent.tax_rate;
  }

  // 5. Créer la variante
  const variant = await ProductService.create(variantData);

  // 6. S'assurer que le parent est marqué comme famille
  if (!parent.is_family) {
    await parent.update({ is_family: true });
  }

  res.status(201).json({
    success: true,
    data: transformFromDb(variant)
  });
});
```

### Code Frontend : Gestion de l'affichage

```javascript
// CatalogModule.js

// État pour les familles dépliées
const [expandedFamilies, setExpandedFamilies] = useState(new Set());

// Toggle déplier/replier
const toggleFamily = (familyId) => {
  setExpandedFamilies(prev => {
    const newSet = new Set(prev);
    if (newSet.has(familyId)) {
      newSet.delete(familyId);
    } else {
      newSet.add(familyId);
    }
    return newSet;
  });
};

// Récupérer les variantes d'une famille
const getItemVariants = useCallback((familyId) => {
  return items.filter(item => item.parentId === familyId && item.isVariant);
}, [items]);

// Filtrer les items pour la liste (exclure les variantes du niveau root)
const filteredItems = useMemo(() => {
  return items.filter(item => {
    // ... autres filtres ...

    // Ne pas afficher les variantes au niveau root
    if (item.isVariant) return false;

    return true;
  });
}, [items, ...]);

// Rendu d'un item
const renderItem = (item, isVariantRow = false) => {
  const variants = item.isFamily ? getItemVariants(item.id) : [];
  const isExpanded = expandedFamilies.has(item.id);

  return (
    <React.Fragment key={item.id}>
      <tr>
        {/* Chevron pour déplier si c'est une famille */}
        {item.isFamily && variants.length > 0 && (
          <button onClick={() => toggleFamily(item.id)}>
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        )}
        {/* ... reste du rendu ... */}
      </tr>

      {/* Afficher les variantes si déplié */}
      {item.isFamily && isExpanded && variants.map(variant =>
        renderItem(variant, true)  // true = c'est une variante
      )}
    </React.Fragment>
  );
};
```

### Suppression d'une famille

```
┌─────────────────────────────────────────────────────────────────┐
│ CASCADE DELETE                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Quand une famille est supprimée, toutes ses variantes sont      │
│  supprimées automatiquement grâce à la contrainte FK:            │
│                                                                  │
│  parent_id UUID REFERENCES products_services(id) ON DELETE CASCADE
│                                                                  │
│  Exemple:                                                        │
│  DELETE famille "Vitamine C" (id: abc-123)                       │
│    → Supprime automatiquement:                                   │
│      - Vitamine C 500mg (parent_id: abc-123)                     │
│      - Vitamine C 1000mg (parent_id: abc-123)                    │
│      - Vitamine C 2000mg (parent_id: abc-123)                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Routes CRUD (clinicCrudRoutes)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/v1/products` | Liste paginée avec filtres |
| GET | `/api/v1/products/:id` | Détail d'un produit |
| POST | `/api/v1/products` | Créer un produit |
| PUT | `/api/v1/products/:id` | Mettre à jour |
| DELETE | `/api/v1/products/:id` | Supprimer |

### Routes personnalisées

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/v1/products/families` | Liste des familles avec variantes |
| POST | `/api/v1/products/:id/variants` | Créer une variante |
| POST | `/api/v1/products/:id/duplicate` | Dupliquer un produit |
| GET | `/api/v1/products/stats` | Statistiques du catalogue |

### Paramètres de requête (GET /products)

| Paramètre | Type | Description |
|-----------|------|-------------|
| `page` | number | Page (défaut: 1) |
| `limit` | number | Limite (défaut: 20, max: 1000) |
| `search` | string | Recherche dans title, description, sku, provenance |
| `itemType` | string | Filtrer par type: medication, treatment, service |
| `isActive` | boolean | Filtrer par statut actif |
| `isFamily` | boolean | Filtrer les familles |
| `isVariant` | boolean | Filtrer les variantes |
| `parentId` | UUID | Variantes d'une famille |
| `includeVariants` | boolean | Inclure les variantes (ignoré dans les filtres DB) |

---

## Mapping des champs

### API (camelCase) ↔ Base de données (snake_case)

```javascript
const fieldMapping = {
  itemType: 'item_type',
  unitPrice: 'unit_price',
  taxRate: 'tax_rate',
  isActive: 'is_active',
  prepBefore: 'prep_before',
  prepAfter: 'prep_after',
  dosageUnit: 'dosage_unit',
  isOverlappable: 'is_overlappable',
  machineTypeId: 'machine_type_id',
  parentId: 'parent_id',
  isFamily: 'is_family',
  isVariant: 'is_variant'
};
```

### Transformation API → DB

```javascript
// Entrée API
{ title: "Botox", unitPrice: 150, taxRate: 20, isActive: true }

// Sortie DB
{ title: "Botox", unit_price: 150, tax_rate: 20, is_active: true }
```

---

## ModelFactory - Associations

Les associations many-to-many utilisent des modèles de jonction explicites pour éviter les problèmes de timestamps.

```javascript
// ModelFactory.js - setupAssociations

// Modèle de jonction sans timestamps
dbModels.ProductCategory = clinicDb.define('ProductCategory', {}, {
  tableName: 'product_categories',
  timestamps: false
});

// Association bidirectionnelle
ProductService.belongsToMany(Category, {
  through: dbModels.ProductCategory,
  foreignKey: 'product_service_id',
  otherKey: 'category_id',
  as: 'categories'
});

Category.belongsToMany(ProductService, {
  through: dbModels.ProductCategory,
  foreignKey: 'category_id',
  otherKey: 'product_service_id',
  as: 'products'
});
```

**Important** : Les deux côtés de l'association doivent être définis pour que les `include` fonctionnent dans les requêtes Sequelize.

---

## Hooks clinicCrudRoutes

### onBeforeCreate

```javascript
onBeforeCreate: async (data, user, clinicDb) => {
  // Transformer camelCase → snake_case
  // Ajouter company_id
  // Extraire categoryIds pour association après création
  return dbData;
}
```

### onAfterCreate

```javascript
onAfterCreate: async (item, data, user, clinicDb) => {
  // Associer les catégories via item.setCategories()
}
```

### onBeforeUpdate

```javascript
// ATTENTION: Ordre des paramètres différent !
onBeforeUpdate: async (data, existingItem, user, clinicDb) => {
  // Mettre à jour les catégories via existingItem.setCategories()
  return dbData;
}
```

---

## Permissions

| Permission | Description |
|------------|-------------|
| `catalog.view` | Voir le catalogue |
| `catalog.create` | Créer des produits |
| `catalog.edit` | Modifier des produits |
| `catalog.delete` | Supprimer des produits |

---

## Frontend

### Fichiers principaux

| Fichier | Description |
|---------|-------------|
| `src/components/dashboard/modules/CatalogModule.js` | Module principal |
| `src/components/dashboard/modals/CatalogFormModal.js` | Formulaire création/édition |
| `src/utils/catalogStorage.js` | Cache et opérations CRUD |
| `src/api/catalogApi.js` | Client API |
| `src/constants/catalogConfig.js` | Configuration (types, unités) |

### Transformation Frontend

```javascript
// API response → Frontend state
const transformedItems = loadedItems.map(item => ({
  ...item,
  name: item.title || item.name,
  type: item.itemType || item.type,
  price: item.unitPrice ?? item.price ?? 0,
  vatRate: item.taxRate ?? item.vatRate ?? 20,
  isActive: item.isActive !== false,
  category: item.categories?.[0]?.id || null
}));
```

---

## Types de produits

| Type | Champs spécifiques | Impact |
|------|-------------------|--------|
| `medication` | dosage, dosageUnit, provenance | Peut avoir des variantes |
| `treatment` | dosage, dosageUnit, volume, provenance, duration | Peut avoir des variantes, impacte les RDV |
| `service` | duration | Impacte la durée des RDV |
| `product` | - | Produit générique |

---

## Intégration avec les RDV

Les services et traitements avec une `duration` définie peuvent impacter automatiquement la durée des rendez-vous lors de la sélection.

```javascript
// Champs utilisés pour les RDV
{
  duration: 60,      // Durée du soin en minutes
  prepBefore: 15,    // Temps de préparation
  prepAfter: 10      // Temps post-soin
}
// Durée totale RDV = prepBefore + duration + prepAfter = 85 minutes
```

---

## Catégories

Les catégories sont typées et regroupées par type de produit.

```javascript
// GET /api/v1/categories/grouped
{
  "medication": [
    { "id": "...", "name": "Vitamines", "color": "#10B981" },
    { "id": "...", "name": "Antibiotiques", "color": "#EF4444" }
  ],
  "treatment": [
    { "id": "...", "name": "Injections", "color": "#3B82F6" }
  ],
  "service": [
    { "id": "...", "name": "Consultations", "color": "#8B5CF6" }
  ]
}
```
