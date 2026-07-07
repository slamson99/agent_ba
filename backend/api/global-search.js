const fetch = require('node-fetch');

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch (e) {
    return '';
  }
}

// Deep recursive key scanner for tracking numbers
function scanForTrackingNumbers(obj, trackingList = []) {
  if (!obj || typeof obj !== 'object') return trackingList;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      scanForTrackingNumbers(item, trackingList);
    }
  } else {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (key.toLowerCase().includes('tracking')) {
        if (typeof val === 'string' && val.trim()) {
          val.split(/[,;]/).forEach(t => {
            const cleaned = t.trim();
            if (cleaned && !trackingList.includes(cleaned)) {
              trackingList.push(cleaned);
            }
          });
        } else if (typeof val === 'number') {
          const cleaned = String(val).trim();
          if (cleaned && !trackingList.includes(cleaned)) {
            trackingList.push(cleaned);
          }
        }
      } else {
        scanForTrackingNumbers(val, trackingList);
      }
    }
  }
  return trackingList;
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    const cleanQuery = query.trim();

    // Fire low-weight index calls concurrently (limit=1000 to maximize history)
    const [productsRes, salesRes] = await Promise.allSettled([
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Search=${encodeURIComponent(cleanQuery)}`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(cleanQuery)}&limit=1000`, { headers })
    ]);

    let products = [];
    let sales = [];

    // Parse Product List with Strict Product Matching Guard
    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      const pData = await productsRes.value.json();
      const rawProducts = pData.Products || [];
      const qLower = cleanQuery.toLowerCase();
      // Only retain products where SKU or Name contains the query
      products = rawProducts.filter(p =>
        (p.SKU || '').toLowerCase().includes(qLower) ||
        (p.Name || '').toLowerCase().includes(qLower)
      );
    }

    // Parse Sales List & Filter VOID orders
    if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
      const sData = await salesRes.value.json();
      const rawSales = sData.SaleList || [];
      sales = rawSales.filter(s => s.Status && s.Status.toUpperCase() !== 'VOID' && s.Status.toUpperCase() !== 'VOIDED');
    }

    // Pre-Hydration Chronological Sort
    sales.sort((a, b) => {
      const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
      const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
      return db - da;
    });

    // Expand Card Visibility Index to 10 items
    const slicedSales = sales.slice(0, 10);

    // Hydrate Sales concurrently
    const detailedSales = await Promise.all(slicedSales.map(async (sale) => {
      try {
        const saleId = sale.SaleID || sale.ID || '';
        const [detailRes, fulRes] = await Promise.all([
          fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Sale?ID=${saleId}`, { headers }),
          fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Sale/Fulfilment?TaskID=${saleId}`, { headers })
        ]);

        let detailData = {}, fulData = {};
        if (detailRes.ok) detailData = await detailRes.json();
        if (fulRes.ok) fulData = await fulRes.json();

        // Relational Data Hydration: Look up Customer profile using CustomerID
        const customerId = detailData.CustomerID || sale.CustomerID || '';
        let customerProfile = null;
        if (customerId) {
          try {
            const custRes = await fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Customer?ID=${customerId}`, { headers });
            if (custRes.ok) {
              const cData = await custRes.json();
              customerProfile = cData.CustomerList && cData.CustomerList[0];
            }
          } catch (custErr) {
            console.error(`Failed to fetch Customer info for ID ${customerId}:`, custErr);
          }
        }

        const customerDiscount = (customerProfile && customerProfile.Discount !== undefined) ? customerProfile.Discount : (detailData.Discount || 0);
        const customerAreaCode = (customerProfile && customerProfile.AdditionalAttribute6) || (detailData.AdditionalAttribute6) || 'N/A';

        // Run deep recursive tracking scanner
        const trackingList = [];
        scanForTrackingNumbers(detailData, trackingList);
        scanForTrackingNumbers(fulData, trackingList);

        // Fetch shipping notes
        let shippingNotesList = [];
        if (detailData.ShippingNotes) shippingNotesList.push(detailData.ShippingNotes);
        const fulfillments = detailData.Fulfillments || detailData.Fulfillment || [];
        if (Array.isArray(fulfillments)) {
          fulfillments.forEach(f => {
            if (f && f.Ship && (f.Ship.Notes || f.Ship.ShippingNotes || f.Ship.Comment)) {
              shippingNotesList.push(f.Ship.Notes || f.Ship.ShippingNotes || f.Ship.Comment);
            }
          });
        }

        // Parse Invoice Status & Due Date out of the first available invoice object
        const invoices = detailData.Invoices || detailData.Invoice || [];
        const invoiceArr = Array.isArray(invoices) ? invoices : (invoices ? [invoices] : []);
        const targetInvoice = invoiceArr[0];
        
        let invoiceNumber = 'N/A';
        let invoiceDueDate = null;
        let invoiceStatus = 'UNPAID';
        let invoiceAmount = detailData.Order ? (detailData.Order.TotalBeforeTax || detailData.Order.Total) : sale.InvoiceAmount;

        if (targetInvoice) {
          invoiceNumber = targetInvoice.InvoiceNumber || 'N/A';
          invoiceDueDate = formatDate(targetInvoice.DueDate || targetInvoice.InvoiceDueDate || targetInvoice.InvoiceDate);
          
          const invStatus = (targetInvoice.Status || '').toUpperCase();
          const balanceDue = targetInvoice.BalanceDue !== undefined 
            ? targetInvoice.BalanceDue 
            : (invoiceAmount - (targetInvoice.Paid || 0));
          
          if (invStatus === 'PAID' || balanceDue <= 0) {
            invoiceStatus = 'PAID';
          } else if (invStatus === 'PARTIALLY PAID' || (balanceDue > 0 && balanceDue < invoiceAmount)) {
            invoiceStatus = 'PARTIALLY PAID';
          } else {
            invoiceStatus = 'UNPAID';
          }
        }

        return {
          ...sale,
          SaleID: saleId,
          CustomerID: customerId,
          OrderNumber: sale.OrderNumber || detailData.OrderNumber || 'Unassigned',
          OrderDate: formatDate(detailData.OrderDate || detailData.Created || sale.OrderDate),
          Status: detailData.Status || sale.Status || 'Draft',
          Customer: detailData.Customer || sale.Customer || 'Unknown Customer',
          InvoiceNumber: invoiceNumber,
          InvoiceDueDate: invoiceDueDate,
          InvoiceStatus: invoiceStatus,
          InvoiceAmount: invoiceAmount || 0,
          CustomerReference: detailData.CustomerReference || 'N/A',
          ShippingNotes: shippingNotesList.filter((v, i, a) => a.indexOf(v) === i && v).join('; ') || 'N/A',
          AreaCode: customerAreaCode,
          SalesRepresentative: detailData.SalesRepresentative || 'N/A',
          Discount: customerDiscount,
          Email: detailData.Email || 'N/A',
          TrackingNumber: trackingList.length > 0 ? trackingList.join(', ') : 'N/A',
          OrderLines: detailData.Order ? (detailData.Order.Lines || []) : []
        };
      } catch (err) {
        console.error("Failed to hydrate sale details:", err);
        return sale;
      }
    }));

    // Default Sort Allocation: Newest sales orders first
    detailedSales.sort((a, b) => {
      const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
      const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
      return db - da;
    });

    return res.status(200).json({ products, sales: detailedSales });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
