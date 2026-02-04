/**
 * PDF Service — Server-side PDF generation & Factur-X PDF/A-3 embedding
 *
 * Pipeline:
 *   1. pdfkit  → Render visual invoice/quote layout (A4)
 *   2. pdf-lib → Post-process: embed CII XML as attachment + XMP metadata (PDF/A-3b)
 *
 * Zero medical dependency — works with generic billing document data.
 */

const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLibDocument, PDFName, PDFString, PDFArray, PDFDict, PDFHexString, AFRelationship } = require('pdf-lib');

// ============================================================================
// Constants
// ============================================================================

const PAGE = {
  WIDTH: 595.28,   // A4 in points
  HEIGHT: 841.89,
  MARGIN: 50,
  CONTENT_WIDTH: 495.28  // WIDTH - 2*MARGIN
};

const COLORS = {
  primary: '#2563EB',
  dark: '#1F2937',
  gray: '#6B7280',
  lightGray: '#E5E7EB',
  tableHeader: '#F3F4F6',
  white: '#FFFFFF'
};

const FONT_SIZES = {
  title: 20,
  subtitle: 12,
  normal: 9,
  small: 8,
  label: 8
};

// ============================================================================
// Helpers
// ============================================================================

function formatDate(dateInput) {
  if (!dateInput) return 'N/A';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCurrency(amount, currency = 'EUR') {
  const n = parseFloat(amount) || 0;
  const symbols = { EUR: '€', USD: '$', GBP: '£' };
  return `${n.toFixed(2)} ${symbols[currency] || currency}`;
}

function getDocumentTitle(documentType) {
  const titles = {
    invoice: 'FACTURE',
    quote: 'DEVIS',
    credit_note: 'AVOIR'
  };
  return titles[documentType] || 'DOCUMENT';
}

function getAddressString(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  const parts = [addr.line1, addr.line2, [addr.postalCode || addr.postal_code, addr.city].filter(Boolean).join(' '), addr.country].filter(Boolean);
  return parts.join('\n');
}

// ============================================================================
// Step 1 — PDFKit: Visual rendering
// ============================================================================

/**
 * Generate the visual PDF document.
 *
 * @param {Object} document - Document record
 * @param {Array}  items    - Document line items
 * @param {Object} options  - { billingSettings }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateDocumentPDF(document, items, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE.MARGIN,
        info: {
          Title: `${getDocumentTitle(document.document_type)} ${document.document_number || ''}`.trim(),
          Author: document.seller_name || 'Medical Pro',
          Subject: `Document ${document.document_number || ''}`,
          Creator: 'Medical Pro Billing'
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      let currentPage = 1;
      let totalPages = 1; // estimated, updated after

      // --- Header ---
      drawHeader(doc, document);

      // --- Parties (seller / buyer) ---
      drawParties(doc, document, options.billingSettings);

      // --- Dates row ---
      drawDatesRow(doc, document);

      // --- Items table ---
      drawItemsTable(doc, document, items);

      // --- Totals ---
      drawTotals(doc, document);

      // --- Conditions ---
      drawConditions(doc, document, options.billingSettings);

      // --- Legal footer ---
      drawLegalFooter(doc, document, options.billingSettings);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawHeader(doc, document) {
  const docType = document.document_type || 'invoice';
  const title = getDocumentTitle(docType);

  // Title
  doc.fontSize(FONT_SIZES.title)
    .fillColor(COLORS.primary)
    .text(title, PAGE.MARGIN, PAGE.MARGIN, { align: 'left' });

  // Document number
  doc.fontSize(FONT_SIZES.subtitle)
    .fillColor(COLORS.dark)
    .text(`N° ${document.document_number || 'BROUILLON'}`, PAGE.MARGIN, PAGE.MARGIN + 28, { align: 'left' });

  // Status badge
  const status = (document.status || 'draft').toUpperCase();
  doc.fontSize(FONT_SIZES.small)
    .fillColor(COLORS.gray)
    .text(status, PAGE.WIDTH - PAGE.MARGIN - 100, PAGE.MARGIN + 5, { width: 100, align: 'right' });

  doc.moveDown(0.5);

  // Separator line
  const y = doc.y + 5;
  doc.moveTo(PAGE.MARGIN, y)
    .lineTo(PAGE.WIDTH - PAGE.MARGIN, y)
    .strokeColor(COLORS.lightGray)
    .lineWidth(1)
    .stroke();

  doc.y = y + 15;
}

function drawParties(doc, document, billingSettings) {
  const startY = doc.y;
  const colWidth = PAGE.CONTENT_WIDTH / 2 - 10;
  const settings = billingSettings || {};
  const seller = settings.seller || {};

  // --- Seller column (left) ---
  doc.fontSize(FONT_SIZES.label)
    .fillColor(COLORS.primary)
    .text('ÉMETTEUR', PAGE.MARGIN, startY, { width: colWidth });

  doc.fontSize(FONT_SIZES.normal)
    .fillColor(COLORS.dark)
    .text(document.seller_name || seller.name || 'N/A', PAGE.MARGIN, startY + 14, { width: colWidth });

  const sellerAddress = getAddressString(document.seller_address || seller.address);
  if (sellerAddress) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(sellerAddress, PAGE.MARGIN, doc.y + 2, { width: colWidth });
  }

  // Seller identifiers
  const identifiers = [];
  if (seller.siren || document.seller_siren) identifiers.push(`SIREN: ${seller.siren || document.seller_siren}`);
  if (seller.vatNumber || document.seller_vat_number) identifiers.push(`TVA: ${seller.vatNumber || document.seller_vat_number}`);
  if (seller.rcs) identifiers.push(`RCS: ${seller.rcs}`);
  if (identifiers.length > 0) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(identifiers.join(' — '), PAGE.MARGIN, doc.y + 2, { width: colWidth });
  }

  const sellerEndY = doc.y;

  // --- Buyer column (right) ---
  const rightX = PAGE.MARGIN + colWidth + 20;

  doc.fontSize(FONT_SIZES.label)
    .fillColor(COLORS.primary)
    .text('DESTINATAIRE', rightX, startY, { width: colWidth });

  doc.fontSize(FONT_SIZES.normal)
    .fillColor(COLORS.dark)
    .text(document.buyer_name || 'N/A', rightX, startY + 14, { width: colWidth });

  const buyerAddress = getAddressString(document.buyer_address);
  if (buyerAddress) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(buyerAddress, rightX, doc.y + 2, { width: colWidth });
  }

  if (document.buyer_email) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(document.buyer_email, rightX, doc.y + 2, { width: colWidth });
  }

  // Move below both columns
  doc.y = Math.max(sellerEndY, doc.y) + 20;
}

function drawDatesRow(doc, document) {
  const y = doc.y;
  const colWidth = PAGE.CONTENT_WIDTH / 3;

  const dates = [
    { label: "Date d'émission", value: formatDate(document.issue_date) },
    { label: "Date d'échéance", value: formatDate(document.due_date) },
    { label: 'Date de livraison', value: formatDate(document.delivery_date || document.issue_date) }
  ];

  // Background
  doc.rect(PAGE.MARGIN, y, PAGE.CONTENT_WIDTH, 35)
    .fillColor(COLORS.tableHeader)
    .fill();

  dates.forEach((d, i) => {
    const x = PAGE.MARGIN + (colWidth * i) + 8;
    doc.fontSize(FONT_SIZES.label)
      .fillColor(COLORS.gray)
      .text(d.label, x, y + 6, { width: colWidth - 16 });
    doc.fontSize(FONT_SIZES.normal)
      .fillColor(COLORS.dark)
      .text(d.value, x, y + 18, { width: colWidth - 16 });
  });

  doc.y = y + 45;
}

function drawItemsTable(doc, document, items) {
  const tableItems = items || [];
  if (tableItems.length === 0) return;

  const currency = document.currency || 'EUR';

  // Column definitions
  const cols = [
    { header: '#',           width: 25,  align: 'center' },
    { header: 'Description', width: 210, align: 'left' },
    { header: 'Qté',         width: 40,  align: 'right' },
    { header: 'P.U. HT',     width: 65,  align: 'right' },
    { header: 'Remise',      width: 45,  align: 'right' },
    { header: 'TVA',         width: 40,  align: 'right' },
    { header: 'Total HT',    width: 70,  align: 'right' }
  ];

  const tableX = PAGE.MARGIN;
  const rowHeight = 22;
  const headerHeight = 20;

  function drawTableHeader(y) {
    // Header background
    doc.rect(tableX, y, PAGE.CONTENT_WIDTH, headerHeight)
      .fillColor(COLORS.primary)
      .fill();

    let x = tableX + 4;
    cols.forEach(col => {
      doc.fontSize(FONT_SIZES.label)
        .fillColor(COLORS.white)
        .text(col.header, x, y + 5, { width: col.width - 8, align: col.align });
      x += col.width;
    });

    return y + headerHeight;
  }

  let currentY = drawTableHeader(doc.y);

  tableItems.forEach((item, idx) => {
    // Check if we need a new page
    if (currentY + rowHeight > PAGE.HEIGHT - 150) {
      doc.addPage();
      currentY = drawTableHeader(PAGE.MARGIN);
    }

    // Alternating row background
    if (idx % 2 === 0) {
      doc.rect(tableX, currentY, PAGE.CONTENT_WIDTH, rowHeight)
        .fillColor(COLORS.tableHeader)
        .fill();
    }

    const qty = parseFloat(item.quantity) || 1;
    const unitPrice = parseFloat(item.unit_price || item.unitPrice) || 0;
    const discountPct = parseFloat(item.discount_percent || item.discountPercent) || 0;
    const taxRate = parseFloat(item.tax_rate || item.taxRate) || 0;
    const lineNet = parseFloat(item.line_net_amount || item.lineNetAmount) || (qty * unitPrice * (1 - discountPct / 100));

    const rowData = [
      String(idx + 1),
      item.description || '',
      qty.toString(),
      unitPrice.toFixed(2),
      discountPct > 0 ? `${discountPct}%` : '-',
      `${taxRate}%`,
      lineNet.toFixed(2)
    ];

    let x = tableX + 4;
    rowData.forEach((text, colIdx) => {
      doc.fontSize(FONT_SIZES.normal)
        .fillColor(COLORS.dark)
        .text(text, x, currentY + 6, {
          width: cols[colIdx].width - 8,
          align: cols[colIdx].align,
          lineBreak: false
        });
      x += cols[colIdx].width;
    });

    currentY += rowHeight;
  });

  // Bottom border
  doc.moveTo(tableX, currentY)
    .lineTo(tableX + PAGE.CONTENT_WIDTH, currentY)
    .strokeColor(COLORS.lightGray)
    .lineWidth(0.5)
    .stroke();

  doc.y = currentY + 15;
}

function drawTotals(doc, document) {
  const currency = document.currency || 'EUR';
  const rightX = PAGE.WIDTH - PAGE.MARGIN - 200;
  const labelX = rightX;
  const valueX = rightX + 120;
  const colWidth = 80;

  const subtotal = parseFloat(document.subtotal) || 0;
  const discountAmount = parseFloat(document.discount_amount) || 0;
  const taxAmount = parseFloat(document.tax_amount) || 0;
  const total = parseFloat(document.total) || 0;

  let y = doc.y;

  // Subtotal
  doc.fontSize(FONT_SIZES.normal).fillColor(COLORS.gray)
    .text('Sous-total HT', labelX, y, { width: 120, align: 'right' });
  doc.fillColor(COLORS.dark)
    .text(formatCurrency(subtotal, currency), valueX, y, { width: colWidth, align: 'right' });
  y += 16;

  // Discount
  if (discountAmount > 0) {
    doc.fillColor(COLORS.gray)
      .text('Remise globale', labelX, y, { width: 120, align: 'right' });
    doc.fillColor(COLORS.dark)
      .text(`-${formatCurrency(discountAmount, currency)}`, valueX, y, { width: colWidth, align: 'right' });
    y += 16;
  }

  // Tax
  doc.fillColor(COLORS.gray)
    .text('TVA', labelX, y, { width: 120, align: 'right' });
  doc.fillColor(COLORS.dark)
    .text(formatCurrency(taxAmount, currency), valueX, y, { width: colWidth, align: 'right' });
  y += 20;

  // Separator
  doc.moveTo(labelX, y)
    .lineTo(valueX + colWidth, y)
    .strokeColor(COLORS.primary)
    .lineWidth(1.5)
    .stroke();
  y += 8;

  // Grand total
  doc.fontSize(FONT_SIZES.subtitle).fillColor(COLORS.primary)
    .text('TOTAL TTC', labelX, y, { width: 120, align: 'right' });
  doc.fontSize(FONT_SIZES.subtitle).fillColor(COLORS.dark)
    .text(formatCurrency(total, currency), valueX, y, { width: colWidth, align: 'right' });

  doc.y = y + 30;
}

function drawConditions(doc, document, billingSettings) {
  const settings = billingSettings || {};

  // Check page space
  if (doc.y > PAGE.HEIGHT - 180) {
    doc.addPage();
  }

  const y = doc.y;
  const conditionsWidth = PAGE.CONTENT_WIDTH;

  doc.fontSize(FONT_SIZES.label)
    .fillColor(COLORS.primary)
    .text('CONDITIONS', PAGE.MARGIN, y);

  let condY = y + 14;

  // Payment terms
  const paymentTerms = document.payment_terms || document.terms || settings.paymentTerms;
  if (paymentTerms) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(`Conditions de paiement : ${paymentTerms}`, PAGE.MARGIN, condY, { width: conditionsWidth });
    condY = doc.y + 4;
  }

  // Late payment penalties
  const penalties = settings.latePaymentPenalty;
  if (penalties) {
    doc.fontSize(FONT_SIZES.small)
      .fillColor(COLORS.gray)
      .text(`Pénalités de retard : ${penalties}`, PAGE.MARGIN, condY, { width: conditionsWidth });
    condY = doc.y + 4;
  }

  // Fixed recovery compensation
  const recovery = settings.recoveryCompensation || '40,00 €';
  doc.fontSize(FONT_SIZES.small)
    .fillColor(COLORS.gray)
    .text(`Indemnité forfaitaire pour frais de recouvrement : ${recovery}`, PAGE.MARGIN, condY, { width: conditionsWidth });
  condY = doc.y + 4;

  // Early payment discount
  const discount = settings.earlyPaymentDiscount || 'Pas d\'escompte pour paiement anticipé';
  doc.fontSize(FONT_SIZES.small)
    .fillColor(COLORS.gray)
    .text(`Escompte : ${discount}`, PAGE.MARGIN, condY, { width: conditionsWidth });

  doc.y = doc.y + 15;
}

function drawLegalFooter(doc, document, billingSettings) {
  const settings = billingSettings || {};
  const seller = settings.seller || {};

  // Position at bottom of page
  const footerY = PAGE.HEIGHT - 60;

  // Separator
  doc.moveTo(PAGE.MARGIN, footerY)
    .lineTo(PAGE.WIDTH - PAGE.MARGIN, footerY)
    .strokeColor(COLORS.lightGray)
    .lineWidth(0.5)
    .stroke();

  // Legal mentions
  const legalParts = [];
  if (seller.name) legalParts.push(seller.name);
  if (seller.legalForm) legalParts.push(seller.legalForm);
  if (seller.capital) legalParts.push(`Capital : ${seller.capital}`);
  if (seller.siren) legalParts.push(`SIREN : ${seller.siren}`);
  if (seller.rcs) legalParts.push(`RCS : ${seller.rcs}`);
  if (seller.vatNumber) legalParts.push(`TVA : ${seller.vatNumber}`);

  const legalText = legalParts.length > 0
    ? legalParts.join(' — ')
    : (settings.legalMentions || document.seller_name || '');

  doc.fontSize(7)
    .fillColor(COLORS.gray)
    .text(legalText, PAGE.MARGIN, footerY + 8, {
      width: PAGE.CONTENT_WIDTH,
      align: 'center',
      lineBreak: true
    });

  // Page number
  doc.fontSize(7)
    .fillColor(COLORS.gray)
    .text(`Page ${doc.bufferedPageRange().start + 1}`, PAGE.MARGIN, footerY + 35, {
      width: PAGE.CONTENT_WIDTH,
      align: 'center'
    });
}

// ============================================================================
// Step 2 — pdf-lib: PDF/A-3b + Factur-X XML embedding
// ============================================================================

/**
 * Embed Factur-X CII XML into a PDF buffer as a PDF/A-3b compliant attachment.
 * Only for invoices / credit_notes (not quotes).
 *
 * @param {Buffer} pdfBuffer  - PDF buffer from step 1
 * @param {string} xmlString  - CII XML string
 * @returns {Promise<Buffer>} PDF/A-3b buffer with embedded XML
 */
async function embedFacturX(pdfBuffer, xmlString) {
  const pdfDoc = await PDFLibDocument.load(pdfBuffer);

  // Embed XML as file attachment
  const xmlBytes = Buffer.from(xmlString, 'utf-8');
  const xmlAttachment = await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
    mimeType: 'text/xml',
    description: 'Factur-X XML Invoice',
    afRelationship: AFRelationship.Data
  });

  // Set PDF/A-3b XMP metadata
  const creationDate = new Date();
  pdfDoc.setTitle('Factur-X Invoice');
  pdfDoc.setCreator('Medical Pro Billing');
  pdfDoc.setProducer('Medical Pro / pdf-lib');
  pdfDoc.setCreationDate(creationDate);
  pdfDoc.setModificationDate(creationDate);

  // Add XMP metadata for PDF/A-3b identification
  const xmpMetadata = buildXMPMetadata(creationDate);
  const metadataStream = pdfDoc.context.stream(Buffer.from(xmpMetadata, 'utf-8'), {
    Type: 'Metadata',
    Subtype: 'XML',
    Length: Buffer.byteLength(xmpMetadata, 'utf-8')
  });
  const metadataRef = pdfDoc.context.register(metadataStream);
  pdfDoc.catalog.set(PDFName.of('Metadata'), metadataRef);

  // Mark PDF/A intent
  const outputIntent = pdfDoc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    RegistryName: PDFString.of('http://www.color.org'),
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1')
  });
  const outputIntentRef = pdfDoc.context.register(outputIntent);
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([outputIntentRef]));

  const savedBytes = await pdfDoc.save();
  return Buffer.from(savedBytes);
}

/**
 * Build XMP metadata XML for PDF/A-3b
 */
function buildXMPMetadata(creationDate) {
  const dateStr = creationDate.toISOString();
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">Factur-X Invoice</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>Medical Pro Billing</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:date>
        <rdf:Seq>
          <rdf:li>${dateStr}</rdf:li>
        </rdf:Seq>
      </dc:date>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The type of the hybrid document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The version of the Factur-X standard</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the Factur-X document</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

module.exports = {
  generateDocumentPDF,
  embedFacturX
};
