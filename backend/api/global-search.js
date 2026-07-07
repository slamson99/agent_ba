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

    // Fire low-weight index calls concurrently to keep it fast
    const [productsRes, salesRes] = await Promise.allSettled([
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Search=${encodeURIComponent(cleanQuery)}`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(cleanQuery)}`, { headers })
    ]);

    let products = [];
    let sales = [];

    // Parse Product List
    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      const pData = await productsRes.value.json();
      products = pData.Products || [];
    }

    // Parse Sales List & Filter VOID orders
    if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
      const sData = await salesRes.value.json();
      const rawSales = sData.SaleList || [];
      sales = rawSales.filter(s => s.Status && s.Status.toUpperCase() !== 'VOID' && s.Status.toUpperCase() !== 'VOIDED');
    }

    // Deep Hydration for matching Sales to get detailed Invoice, Tracking, and Area Code data
    const detailedSales = await Promise.all(sales.slice(0, 5).map(async (sale) => {
      try {
        const saleId = sale.SaleID || sale.ID || '';
        const [detailRes, fulRes] = await Promise.all([
          fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Sale?ID=${saleId}`, { headers }),
          fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Sale/Fulfilment?TaskID=${saleId}`, { headers })
        ]);

        let detailData = {}, fulData = {};
        if (detailRes.ok) detailData = await detailRes.json();
        if (fulRes.ok) fulData = await fulRes.json();

        // Extract Ship lines tracking from the model
        let trackingNumbers = [];
        let shippingNotesList = [];

        // Primary check
        if (fulData.Fulfilment && fulData.Fulfilment.Shipment && fulData.Fulfilment.Shipment.Lines) {
          trackingNumbers = fulData.Fulfilment.Shipment.Lines
            .map(line => line.TrackingNumber)
            .filter(t => t);
          if (fulData.Fulfilment.Shipment.Notes) {
            shippingNotesList.push(fulData.Fulfilment.Shipment.Notes);
          }
        }

        // Secondary fallback checking
        const fulfillments = detailData.Fulfillments || detailData.Fulfillment || [];
        if (Array.isArray(fulfillments)) {
          fulfillments.forEach(f => {
            if (f) {
              const ship = f.Ship || f.Shipment || {};
              if (ship.Lines && Array.isArray(ship.Lines)) {
                ship.Lines.forEach(l => {
                  if (l && l.TrackingNumber) trackingNumbers.push(l.TrackingNumber);
                });
              }
              if (ship.TrackingNumber) {
                trackingNumbers.push(ship.TrackingNumber);
              }
              if (ship.Notes || ship.ShippingNotes || ship.Comment) {
                shippingNotesList.push(ship.Notes || ship.ShippingNotes || ship.Comment);
              }
            }
          });
        }

        const fList = fulData.Fulfillments || fulData.Fulfillment || fulData.FulfillmentsList || [];
        if (Array.isArray(fList)) {
          fList.forEach(f => {
            if (f) {
              const ship = f.Ship || f.Shipment || {};
              const lines = ship.Lines || ship.ShipmentLines || [];
              if (Array.isArray(lines)) {
                lines.forEach(l => {
                  if (l) {
                    if (l.TrackingNumber) {
                      trackingNumbers.push(l.TrackingNumber);
                    }
                    if (l.ShipmentStatus) {
                      trackingNumbers.push(`Status: ${l.ShipmentStatus}`);
                    }
                  }
                });
              }
              if (ship.TrackingNumber) {
                trackingNumbers.push(ship.TrackingNumber);
              }
              if (ship.Notes || ship.ShippingNotes || ship.Comment || ship.ConnectionNotes) {
                shippingNotesList.push(ship.Notes || ship.ShippingNotes || ship.Comment || ship.ConnectionNotes);
              }
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

        const additionalAttribute6 = detailData.AdditionalAttribute6 || (detailData.AdditionalAttributes && detailData.AdditionalAttributes.AdditionalAttribute6) || 'N/A';

        return {
          ...sale,
          OrderNumber: sale.OrderNumber || detailData.OrderNumber || 'Unassigned',
          OrderDate: formatDate(detailData.OrderDate || detailData.Created || sale.OrderDate),
          Status: detailData.Status || sale.Status || 'Draft',
          Customer: detailData.Customer || sale.Customer || 'Unknown Customer',
          InvoiceNumber: invoiceNumber,
          InvoiceDueDate: invoiceDueDate,
          InvoiceStatus: invoiceStatus,
          InvoiceAmount: invoiceAmount || 0,
          CustomerReference: detailData.CustomerReference || 'N/A',
          ShippingNotes: shippingNotesList.filter((v, i, a) => a.indexOf(v) === i && v).join('; ') || detailData.ShippingNotes || 'N/A',
          AreaCode: additionalAttribute6,
          SalesRepresentative: detailData.SalesRepresentative || 'N/A',
          Discount: detailData.Discount || 0,
          Email: detailData.Email || 'N/A',
          TrackingNumber: trackingNumbers.filter((v, i, a) => a.indexOf(v) === i && v).join(', ') || 'N/A',
          OrderLines: detailData.Order ? (detailData.Order.Lines || []) : []
        };
      } catch (err) {
        console.error("Failed to hydrate sale details:", err);
        return sale;
      }
    }));

    // Dynamic Relevance Priority Sorting
    const cleanQueryLower = cleanQuery.toLowerCase();
    detailedSales.sort((a, b) => {
      const aName = (a.Customer || '').toLowerCase();
      const bName = (b.Customer || '').toLowerCase();
      const aExact = aName === cleanQueryLower || a.OrderNumber.toLowerCase() === cleanQueryLower;
      const bExact = bName === cleanQueryLower || b.OrderNumber.toLowerCase() === cleanQueryLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
      const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
      return db - da;
    });

    return res.status(200).json({ products, sales: detailedSales });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
