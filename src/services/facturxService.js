/**
 * Factur-X Service — CII XML generation & structural validation
 *
 * Generates Cross-Industry Invoice (CII) XML compliant with Factur-X profiles.
 * Zero medical dependency — works with generic billing document data.
 *
 * Profiles: MINIMUM, BASIC, EN16931, EXTENDED
 * Standards: EN 16931, Factur-X 1.0
 */

const { create } = require('xmlbuilder2');

// ============================================================================
// Constants
// ============================================================================

const PROFILE_URNS = {
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  BASIC: 'urn:factur-x.eu:1p0:basic',
  EN16931: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931',
  EXTENDED: 'urn:factur-x.eu:1p0:extended'
};

const TYPE_CODES = {
  invoice: '380',
  credit_note: '381'
};

const NAMESPACES = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
};

// Required fields per profile for validation
const REQUIRED_FIELDS = {
  MINIMUM: ['documentNumber', 'typeCode', 'issueDate', 'sellerName', 'buyerName', 'currency', 'total'],
  BASIC: ['documentNumber', 'typeCode', 'issueDate', 'sellerName', 'buyerName', 'currency', 'total', 'taxAmount'],
  EN16931: ['documentNumber', 'typeCode', 'issueDate', 'sellerName', 'buyerName', 'currency', 'total', 'taxAmount', 'subtotal'],
  EXTENDED: ['documentNumber', 'typeCode', 'issueDate', 'sellerName', 'buyerName', 'currency', 'total', 'taxAmount', 'subtotal']
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a date as CII format YYYYMMDD
 */
function formatDateCII(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Round to 2 decimal places
 */
function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

/**
 * Format amount to 2 decimal string
 */
function amt(n) {
  return round2(n).toFixed(2);
}

// ============================================================================
// XML Builder Functions
// ============================================================================

function buildExchangedDocumentContext(root, profile) {
  const ctx = root.ele('rsm:ExchangedDocumentContext');
  const guide = ctx.ele('ram:GuidelineSpecifiedDocumentContextParameter');
  guide.ele('ram:ID').txt(PROFILE_URNS[profile] || PROFILE_URNS.EN16931);
  return ctx;
}

function buildExchangedDocument(root, document) {
  const doc = root.ele('rsm:ExchangedDocument');
  // BT-1: Document number
  doc.ele('ram:ID').txt(document.document_number || document.documentNumber || 'DRAFT');
  // BT-3: TypeCode
  const docType = document.document_type || document.documentType || 'invoice';
  doc.ele('ram:TypeCode').txt(TYPE_CODES[docType] || '380');
  // BT-2: Issue date
  const issueDate = formatDateCII(document.issue_date || document.issueDate);
  if (issueDate) {
    const dt = doc.ele('ram:IssueDateTime');
    dt.ele('udt:DateTimeString').att('format', '102').txt(issueDate);
  }
  // BT-22: Notes
  if (document.notes) {
    const note = doc.ele('ram:IncludedNote');
    note.ele('ram:Content').txt(document.notes);
  }
  return doc;
}

function buildSellerTradeParty(agreement, document) {
  const seller = agreement.ele('ram:SellerTradeParty');
  // BG-4: Seller name
  seller.ele('ram:Name').txt(document.seller_name || document.sellerName || 'N/A');

  // Seller legal registration (SIREN)
  if (document.seller_siren || document.sellerSiren) {
    const legalOrg = seller.ele('ram:SpecifiedLegalOrganization');
    const idNode = legalOrg.ele('ram:ID');
    idNode.att('schemeID', '0002'); // SIREN scheme
    idNode.txt(document.seller_siren || document.sellerSiren);
  }

  // BG-5: Seller address
  const sellerAddr = document.seller_address || document.sellerAddress;
  if (sellerAddr) {
    const addr = seller.ele('ram:PostalTradeAddress');
    if (typeof sellerAddr === 'object') {
      if (sellerAddr.line1) addr.ele('ram:LineOne').txt(sellerAddr.line1);
      if (sellerAddr.line2) addr.ele('ram:LineTwo').txt(sellerAddr.line2);
      if (sellerAddr.postalCode || sellerAddr.postal_code) addr.ele('ram:PostcodeCode').txt(sellerAddr.postalCode || sellerAddr.postal_code);
      if (sellerAddr.city) addr.ele('ram:CityName').txt(sellerAddr.city);
      addr.ele('ram:CountryID').txt(sellerAddr.country || 'FR');
    } else {
      addr.ele('ram:LineOne').txt(String(sellerAddr));
      addr.ele('ram:CountryID').txt('FR');
    }
  }

  // Seller email
  if (document.seller_email || document.sellerEmail) {
    const uri = seller.ele('ram:URIUniversalCommunication');
    uri.ele('ram:URIID').att('schemeID', 'EM').txt(document.seller_email || document.sellerEmail);
  }

  // BG-6: Seller VAT
  if (document.seller_vat_number || document.sellerVatNumber) {
    const taxReg = seller.ele('ram:SpecifiedTaxRegistration');
    taxReg.ele('ram:ID').att('schemeID', 'VA').txt(document.seller_vat_number || document.sellerVatNumber);
  }

  return seller;
}

function buildBuyerTradeParty(agreement, document) {
  const buyer = agreement.ele('ram:BuyerTradeParty');
  // BG-7: Buyer name
  buyer.ele('ram:Name').txt(document.buyer_name || document.buyerName || 'N/A');

  // BG-8: Buyer address
  const buyerAddr = document.buyer_address || document.buyerAddress;
  if (buyerAddr) {
    const addr = buyer.ele('ram:PostalTradeAddress');
    if (typeof buyerAddr === 'object') {
      if (buyerAddr.line1) addr.ele('ram:LineOne').txt(buyerAddr.line1);
      if (buyerAddr.line2) addr.ele('ram:LineTwo').txt(buyerAddr.line2);
      if (buyerAddr.postalCode || buyerAddr.postal_code) addr.ele('ram:PostcodeCode').txt(buyerAddr.postalCode || buyerAddr.postal_code);
      if (buyerAddr.city) addr.ele('ram:CityName').txt(buyerAddr.city);
      addr.ele('ram:CountryID').txt(buyerAddr.country || 'FR');
    } else {
      addr.ele('ram:LineOne').txt(String(buyerAddr));
      addr.ele('ram:CountryID').txt('FR');
    }
  }

  // Buyer email
  if (document.buyer_email || document.buyerEmail) {
    const uri = buyer.ele('ram:URIUniversalCommunication');
    uri.ele('ram:URIID').att('schemeID', 'EM').txt(document.buyer_email || document.buyerEmail);
  }

  return buyer;
}

function buildDeliveryTradeAgreement(transaction, document) {
  const delivery = transaction.ele('ram:ApplicableHeaderTradeDelivery');
  // BG-13: Delivery date
  const deliveryDate = formatDateCII(document.delivery_date || document.deliveryDate || document.issue_date || document.issueDate);
  if (deliveryDate) {
    const occ = delivery.ele('ram:ActualDeliverySupplyChainEvent');
    const dt = occ.ele('ram:OccurrenceDateTime');
    dt.ele('udt:DateTimeString').att('format', '102').txt(deliveryDate);
  }
  return delivery;
}

function buildPaymentTerms(settlement, document) {
  // BG-20: Payment terms
  if (document.payment_terms || document.paymentTerms || document.due_date || document.dueDate) {
    const terms = settlement.ele('ram:SpecifiedTradePaymentTerms');
    const termsText = document.payment_terms || document.paymentTerms;
    if (termsText) {
      terms.ele('ram:Description').txt(termsText);
    }
    const dueDate = formatDateCII(document.due_date || document.dueDate);
    if (dueDate) {
      const dt = terms.ele('ram:DueDateDateTime');
      dt.ele('udt:DateTimeString').att('format', '102').txt(dueDate);
    }
  }
}

function buildMonetarySummation(settlement, document) {
  const summation = settlement.ele('ram:SpecifiedTradeSettlementHeaderMonetarySummation');

  const subtotal = parseFloat(document.subtotal) || 0;
  const discountAmount = parseFloat(document.discount_amount || document.discountAmount) || 0;
  const taxAmount = parseFloat(document.tax_amount || document.taxAmount) || 0;
  const total = parseFloat(document.total) || 0;
  const amountDue = parseFloat(document.amount_due || document.amountDue) || total;

  // BT-106: Sum of line net amounts
  summation.ele('ram:LineTotalAmount').txt(amt(subtotal));
  // BT-107: Allowances
  if (discountAmount > 0) {
    summation.ele('ram:AllowanceTotalAmount').txt(amt(discountAmount));
  }
  // BT-109: Tax basis
  summation.ele('ram:TaxBasisTotalAmount').txt(amt(subtotal - discountAmount));
  // BT-110: Tax total
  const taxTotal = summation.ele('ram:TaxTotalAmount');
  taxTotal.att('currencyID', document.currency || 'EUR');
  taxTotal.txt(amt(taxAmount));
  // BT-112: Grand total
  summation.ele('ram:GrandTotalAmount').txt(amt(total));
  // BT-115: Amount due
  summation.ele('ram:DuePayableAmount').txt(amt(amountDue));

  return summation;
}

function buildTaxBreakdown(settlement, document, items) {
  // BG-23: Tax breakdown — group by tax rate
  const taxGroups = {};
  (items || []).forEach(item => {
    const rate = parseFloat(item.tax_rate || item.taxRate) || 0;
    const lineNet = parseFloat(item.line_net_amount || item.lineNetAmount) || 0;
    const key = rate.toFixed(2);
    if (!taxGroups[key]) {
      taxGroups[key] = { rate, basisAmount: 0, taxAmount: 0, categoryCode: item.tax_category_code || item.taxCategoryCode || 'S' };
    }
    taxGroups[key].basisAmount += lineNet;
    taxGroups[key].taxAmount += lineNet * (rate / 100);
  });

  // Fallback: if no items, create single tax group from document totals
  if (Object.keys(taxGroups).length === 0) {
    const rate = parseFloat(document.default_tax_rate || document.defaultTaxRate) || 20;
    const subtotal = parseFloat(document.subtotal) || 0;
    taxGroups[rate.toFixed(2)] = {
      rate,
      basisAmount: subtotal,
      taxAmount: subtotal * (rate / 100),
      categoryCode: 'S'
    };
  }

  Object.values(taxGroups).forEach(group => {
    const tax = settlement.ele('ram:ApplicableTradeTax');
    tax.ele('ram:CalculatedAmount').txt(amt(group.taxAmount));
    tax.ele('ram:TypeCode').txt('VAT');
    tax.ele('ram:BasisAmount').txt(amt(group.basisAmount));
    tax.ele('ram:CategoryCode').txt(group.categoryCode);
    tax.ele('ram:RateApplicablePercent').txt(group.rate.toFixed(2));
  });
}

function buildLineItems(transaction, items, profile) {
  // BG-25..31: Line items
  (items || []).forEach((item, idx) => {
    const line = transaction.ele('ram:IncludedSupplyChainTradeLineItem');

    // Line ID
    const lineDoc = line.ele('ram:AssociatedDocumentLineDocument');
    lineDoc.ele('ram:LineID').txt(String(idx + 1));

    // Product
    const product = line.ele('ram:SpecifiedTradeProduct');
    product.ele('ram:Name').txt(item.description || `Item ${idx + 1}`);

    // Delivery (empty for EN16931 compliance)
    line.ele('ram:SpecifiedLineTradeDelivery');

    // Agreement
    const lineAgreement = line.ele('ram:SpecifiedLineTradeAgreement');
    const netPrice = lineAgreement.ele('ram:NetPriceProductTradePrice');
    const unitPrice = parseFloat(item.unit_price || item.unitPrice) || 0;
    const discountPct = parseFloat(item.discount_percent || item.discountPercent) || 0;
    const effectivePrice = unitPrice * (1 - discountPct / 100);
    netPrice.ele('ram:ChargeAmount').txt(amt(effectivePrice));

    // Delivery quantity
    const lineDelivery = line.ele('ram:SpecifiedLineTradeDelivery');
    const qty = parseFloat(item.quantity) || 1;
    const billedQty = lineDelivery.ele('ram:BilledQuantity');
    billedQty.att('unitCode', item.unit || 'C62'); // C62 = "one" / unit
    billedQty.txt(qty.toString());

    // Settlement
    const lineSettlement = line.ele('ram:SpecifiedLineTradeSettlement');
    // Line tax
    const lineTax = lineSettlement.ele('ram:ApplicableTradeTax');
    const taxRate = parseFloat(item.tax_rate || item.taxRate) || 0;
    lineTax.ele('ram:TypeCode').txt('VAT');
    lineTax.ele('ram:CategoryCode').txt(item.tax_category_code || item.taxCategoryCode || 'S');
    lineTax.ele('ram:RateApplicablePercent').txt(taxRate.toFixed(2));

    // Line total
    const lineNetAmount = parseFloat(item.line_net_amount || item.lineNetAmount) || (qty * effectivePrice);
    const lineSummation = lineSettlement.ele('ram:SpecifiedTradeSettlementLineMonetarySummation');
    lineSummation.ele('ram:LineTotalAmount').txt(amt(lineNetAmount));
  });
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Generate Factur-X CII XML from document + items
 *
 * @param {Object} document - Document record (snake_case or camelCase)
 * @param {Array}  items    - Document line items
 * @param {string} profile  - Factur-X profile: MINIMUM, BASIC, EN16931, EXTENDED
 * @returns {string} XML string
 */
function generateXML(document, items, profile = 'EN16931') {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('rsm:CrossIndustryInvoice', {
      'xmlns:rsm': NAMESPACES.rsm,
      'xmlns:ram': NAMESPACES.ram,
      'xmlns:qdt': NAMESPACES.qdt,
      'xmlns:udt': NAMESPACES.udt
    });

  // 1. Context
  buildExchangedDocumentContext(root, profile);

  // 2. Document header
  buildExchangedDocument(root, document);

  // 3. Supply chain transaction
  const transaction = root.ele('rsm:SupplyChainTradeTransaction');

  // 3a. Line items (before header in CII schema)
  if (profile !== 'MINIMUM') {
    buildLineItems(transaction, items, profile);
  }

  // 3b. Trade agreement (seller/buyer)
  const agreement = transaction.ele('ram:ApplicableHeaderTradeAgreement');
  buildSellerTradeParty(agreement, document);
  buildBuyerTradeParty(agreement, document);

  // 3c. Delivery
  buildDeliveryTradeAgreement(transaction, document);

  // 3d. Settlement
  const settlement = transaction.ele('ram:ApplicableHeaderTradeSettlement');
  // Currency
  settlement.ele('ram:InvoiceCurrencyCode').txt(document.currency || 'EUR');

  // Payment terms
  buildPaymentTerms(settlement, document);

  // Tax breakdown
  if (profile !== 'MINIMUM') {
    buildTaxBreakdown(settlement, document, items);
  }

  // Monetary summation
  buildMonetarySummation(settlement, document);

  return root.end({ prettyPrint: true });
}

/**
 * Validate XML structure for a given Factur-X profile.
 * Lightweight structural validation (no full Schematron).
 *
 * @param {string} xmlString - CII XML string
 * @param {string} profile   - Factur-X profile
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateXML(xmlString, profile = 'EN16931') {
  const errors = [];

  if (!xmlString || typeof xmlString !== 'string') {
    return { valid: false, errors: ['XML string is empty or invalid'] };
  }

  // Check root element
  if (!xmlString.includes('CrossIndustryInvoice')) {
    errors.push('Missing root element CrossIndustryInvoice');
  }

  // Check namespaces
  if (!xmlString.includes('xmlns:rsm')) {
    errors.push('Missing rsm namespace declaration');
  }
  if (!xmlString.includes('xmlns:ram')) {
    errors.push('Missing ram namespace declaration');
  }

  // Check profile URN
  const profileUrn = PROFILE_URNS[profile];
  if (profileUrn && !xmlString.includes(profileUrn)) {
    errors.push(`Missing or incorrect profile URN for ${profile}`);
  }

  // Check mandatory elements
  const mandatoryElements = [
    { tag: 'ram:ID', label: 'Document number (BT-1)' },
    { tag: 'ram:TypeCode', label: 'Type code (BT-3)' },
    { tag: 'ram:IssueDateTime', label: 'Issue date (BT-2)' },
    { tag: 'ram:SellerTradeParty', label: 'Seller party (BG-4)' },
    { tag: 'ram:BuyerTradeParty', label: 'Buyer party (BG-7)' },
    { tag: 'ram:InvoiceCurrencyCode', label: 'Currency code (BT-5)' },
    { tag: 'ram:GrandTotalAmount', label: 'Grand total (BT-112)' },
    { tag: 'ram:DuePayableAmount', label: 'Due payable amount (BT-115)' }
  ];

  mandatoryElements.forEach(({ tag, label }) => {
    if (!xmlString.includes(tag)) {
      errors.push(`Missing mandatory element: ${label} (${tag})`);
    }
  });

  // Profile-specific checks
  if (profile !== 'MINIMUM') {
    if (!xmlString.includes('ram:ApplicableTradeTax')) {
      errors.push('Missing tax breakdown (BG-23) — required for BASIC and above');
    }
    if (!xmlString.includes('ram:IncludedSupplyChainTradeLineItem')) {
      errors.push('Missing line items (BG-25) — required for BASIC and above');
    }
  }

  // Amount coherence checks
  try {
    // Extract amounts for coherence validation
    const grandTotalMatch = xmlString.match(/<ram:GrandTotalAmount>([\d.]+)<\/ram:GrandTotalAmount>/);
    const lineTotalMatch = xmlString.match(/<ram:LineTotalAmount>([\d.]+)<\/ram:LineTotalAmount>/);
    const taxBasisMatch = xmlString.match(/<ram:TaxBasisTotalAmount>([\d.]+)<\/ram:TaxBasisTotalAmount>/);
    const taxTotalMatch = xmlString.match(/<ram:TaxTotalAmount[^>]*>([\d.]+)<\/ram:TaxTotalAmount>/);

    if (grandTotalMatch && taxBasisMatch && taxTotalMatch) {
      const grandTotal = parseFloat(grandTotalMatch[1]);
      const taxBasis = parseFloat(taxBasisMatch[1]);
      const taxTotal = parseFloat(taxTotalMatch[1]);
      const expected = round2(taxBasis + taxTotal);

      if (Math.abs(grandTotal - expected) > 0.02) {
        errors.push(`Amount incoherence: GrandTotal (${grandTotal}) != TaxBasis (${taxBasis}) + Tax (${taxTotal}) = ${expected}`);
      }
    }
  } catch (e) {
    // Non-critical — skip coherence check on parse error
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  generateXML,
  validateXML,
  TYPE_CODES,
  PROFILE_URNS,
  formatDateCII
};
