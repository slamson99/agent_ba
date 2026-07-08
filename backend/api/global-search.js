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

    // Fire index and availability calls concurrently
    const [productsRes, salesRes, availByNameRes, availBySkuRes] = await Promise.allSettled([
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Search=${encodeURIComponent(cleanQuery)}`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(cleanQuery)}&limit=1000`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?name=${encodeURIComponent(cleanQuery)}`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?sku=${encodeURIComponent(cleanQuery)}`, { headers })
    ]);

    let products = [];
    let sales = [];
    const availMap = new Map();

    const jsonPromises = [];

    // Parse Product List
    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      jsonPromises.push(productsRes.value.json().then(pData => {
        const rawProducts = pData.Products || [];
        const qLower = cleanQuery.toLowerCase();
        products = rawProducts.filter(p =>
          (p.SKU || '').toLowerCase().includes(qLower) ||
          (p.Name || '').toLowerCase().includes(qLower)
        );
      }));
    }

    // Parse Sales List & Filter VOID orders
    if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
      jsonPromises.push(salesRes.value.json().then(sData => {
        const rawSales = sData.SaleList || [];
        sales = rawSales.filter(s => s.Status && s.Status.toUpperCase() !== 'VOID' && s.Status.toUpperCase() !== 'VOIDED');
      }));
    }

    // Parse Availability Lists
    const processAvail = async (res) => {
      if (res.status === 'fulfilled' && res.value.ok) {
        try {
          const data = await res.value.json();
          const list = data.ProductAvailabilityList || [];
          for (const item of list) {
            if (item.SKU) {
              availMap.set(item.SKU.toLowerCase(), {
                OnHand: item.OnHand || 0,
                Allocated: item.Allocated || 0,
                OnOrder: item.OnOrder || 0,
                Available: item.Available || 0
              });
            }
          }
        } catch (e) {
          console.error("Failed to parse availability response:", e);
        }
      }
    };

    jsonPromises.push(processAvail(availByNameRes));
    jsonPromises.push(processAvail(availBySkuRes));

    // Await all initial JSON formatting tasks
    await Promise.all(jsonPromises);

    // Hydrate products with availability metrics
    for (const p of products) {
      const skuKey = (p.SKU || '').toLowerCase();
      const stock = availMap.get(skuKey) || { OnHand: 0, Allocated: 0, OnOrder: 0, Available: 0 };
      p.OnHand = stock.OnHand;
      p.Allocated = stock.Allocated;
      p.OnOrder = stock.OnOrder;
      p.Available = stock.Available;
    }

    // Evaluate Search Triage query priority match
    let priorityContext = null;
    const qLower = cleanQuery.toLowerCase();
    const hasProductMatch = products.some(p => {
      const sku = (p.SKU || '').toLowerCase();
      const name = (p.Name || '').toLowerCase();
      const familyName = (p.FamilyName || p.ProductFamily || (p.Family && p.Family.Name) || '').toLowerCase();
      return sku.includes(qLower) || name.includes(qLower) || familyName.includes(qLower);
    });

    if (hasProductMatch) {
      priorityContext = "product";
    }

    // Group variants sharing an active family identity
    const groupedProducts = [];
    const familyMap = new Map();

    for (const p of products) {
      const familyName = p.Family ? p.Family.Name : null;
      const brand = p.Brand || 'N/A';

      const variant = {
        SKU: p.SKU || 'N/A',
        Name: p.Name || 'Unnamed Product',
        OnHand: p.OnHand !== undefined ? p.OnHand : 0,
        Allocated: p.Allocated !== undefined ? p.Allocated : 0,
        OnOrder: p.OnOrder !== undefined ? p.OnOrder : 0,
        PriceTier1: p.PriceTier1 !== undefined ? p.PriceTier1 : 0,
        PriceTier5: p.PriceTier5 !== undefined ? p.PriceTier5 : 0,
        SaleTaxRule: p.SaleTaxRule || 'N/A'
      };

      if (familyName) {
        const key = familyName.toLowerCase();
        if (familyMap.has(key)) {
          familyMap.get(key).Variants.push(variant);
        } else {
          const familyObj = {
            isFamily: true,
            FamilyName: familyName,
            Brand: brand,
            Variants: [variant]
          };
          familyMap.set(key, familyObj);
          groupedProducts.push(familyObj);
        }
      } else {
        groupedProducts.push({
          isFamily: false,
          FamilyName: p.Name || 'Unnamed Product',
          Brand: brand,
          Variants: [variant]
        });
      }
    }

    // Sort variants A-Z by SKU
    for (const fp of groupedProducts) {
      fp.Variants.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
    }

    // Pre-Hydration Chronological Sort for Sales
    sales.sort((a, b) => {
      const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
      const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
      return db - da;
    });

    // Expand Card Visibility Index to 10 items
    const slicedSales = sales.slice(0, 10);

    // Hydrate Sales concurrently (Without /Sale/Fulfilment request)
    const detailedSales = await Promise.all(slicedSales.map(async (sale) => {
      try {
        const saleId = sale.SaleID || sale.ID || '';
        const detailRes = await fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Sale?ID=${saleId}`, { headers });

        let detailData = {};
        if (detailRes.ok) detailData = await detailRes.json();

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

        // Run deep recursive tracking scanner on primary transaction model
        const trackingList = [];
        scanForTrackingNumbers(detailData, trackingList);

        // Fetch shipping notes directly from primary model
        const shippingNotes = detailData.ShippingNotes || 'N/A';

        // Parse Invoice Status & Due Date out of the first available invoice object
        const invoices = detailData.Invoices || detailData.Invoice || [];
        const invoiceArr = Array.isArray(invoices) ? invoices : (invoices ? [invoices] : []);
        const targetInvoice = invoiceArr[0];
        
        let invoiceNumber = 'N/A';
        let invoiceDueDate = null;
        let invoiceStatus = 'UNPAID';
        
        // Tax-inclusive financial balancing total
        let invoiceAmount = sale.InvoiceAmount || 0;
        if (targetInvoice && targetInvoice.Total !== undefined) {
          invoiceAmount = targetInvoice.Total;
        } else if (detailData.Order && detailData.Order.Total !== undefined) {
          invoiceAmount = detailData.Order.Total;
        }

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
          ShippingNotes: shippingNotes,
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

    // Default Chronological Sort Allocation
    detailedSales.sort((a, b) => {
      const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
      const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
      return db - da;
    });

    return res.status(200).json({ products: groupedProducts, sales: detailedSales, priorityContext });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
