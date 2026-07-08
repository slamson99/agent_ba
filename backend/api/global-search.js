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

  const { query, scope } = req.query;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  const activeScope = scope || 'sales';
  const cleanQuery = query.trim();

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    if (activeScope === 'sales') {
      // BLOCK A: Customer Sales Search Pipeline
      let saleListUrl = `https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(cleanQuery)}&limit=1000`;
      
      // Email Search Strategy: If email, fetch resolved CustomerID first
      if (cleanQuery.includes('@')) {
        let customerId = '';
        try {
          const custRes = await fetch(`https://inventory.dearsystems.com/ExternalApi/v2/customer?ContactFilter=${encodeURIComponent(cleanQuery)}`, { headers });
          if (custRes.ok) {
            const custData = await custRes.json();
            if (Array.isArray(custData)) {
              customerId = custData[0] && custData[0].ID;
            } else if (custData.CustomerList && custData.CustomerList.length > 0) {
              customerId = custData.CustomerList[0].ID;
            } else if (custData.Customers && custData.Customers.length > 0) {
              customerId = custData.Customers[0].ID;
            } else if (custData.ID) {
              customerId = custData.ID;
            }
          }
        } catch (err) {
          console.error("Failed to query customer by ContactFilter:", err);
        }

        if (customerId) {
          saleListUrl = `https://inventory.dearsystems.com/ExternalApi/v2/SaleList?CustomerID=${encodeURIComponent(customerId)}&limit=1000`;
        } else {
          // No customer found for email
          return res.status(200).json([]);
        }
      }

      const response = await fetch(saleListUrl, { headers });
      if (!response.ok) {
        throw new Error(`Cin7 Core SaleList returned status ${response.status}`);
      }

      const sData = await response.json();
      const rawSales = sData.SaleList || [];

      // Filter out VOID / Voided immediately
      let sales = rawSales.filter(s => !s.Status || (s.Status.toUpperCase() !== 'VOID' && s.Status.toUpperCase() !== 'VOIDED'));

      // Sort full dataset by OrderDate descending (Newest First)
      sales.sort((a, b) => {
        const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
        const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
        return db - da;
      });

      // Slice top 10 items
      const slicedSales = sales.slice(0, 10);

      // Hydrate Sales details concurrently
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

          // Order lines sorted A-Z by SKU
          const orderLines = detailData.Order ? (detailData.Order.Lines || []) : [];
          orderLines.sort((a, b) => (a.SKU || '').toLowerCase().localeCompare((b.SKU || '').toLowerCase()));

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
            OrderLines: orderLines
          };
        } catch (err) {
          console.error("Failed to hydrate sale details:", err);
          return sale;
        }
      }));

      // Return flat array payload
      return res.status(200).json(detailedSales);

    } else if (activeScope === 'products') {
      // BLOCK B: Product Search Pipeline (with ref/productavailability SKU query)
      const [productsRes, availRes] = await Promise.allSettled([
        fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Search=${encodeURIComponent(cleanQuery)}`, { headers }),
        fetch(`https://inventory.dearsystems.com/ExternalApi/v2/ref/productavailability?Sku=${encodeURIComponent(cleanQuery)}`, { headers })
      ]);

      let products = [];
      const availMap = new Map();
      const jsonPromises = [];

      // Parse Products
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

      // Parse Availability from ref/productavailability
      if (availRes.status === 'fulfilled' && availRes.value.ok) {
        jsonPromises.push(availRes.value.json().then(data => {
          let list = [];
          if (Array.isArray(data)) {
            list = data;
          } else if (data && data.ProductAvailabilityList) {
            list = data.ProductAvailabilityList;
          } else if (data && data.ProductAvailability) {
            list = data.ProductAvailability;
          }
          
          for (const item of list) {
            if (item && item.SKU) {
              availMap.set(item.SKU.toLowerCase(), {
                AvailableStock: item.Available !== undefined ? item.Available : 0,
                OnOrder: item.OnOrder !== undefined ? item.OnOrder : 0
              });
            }
          }
        }).catch(e => console.error("Error parsing ref/productavailability JSON:", e)));
      }

      await Promise.all(jsonPromises);

      // Map stock to products using direct Available assignment
      for (const p of products) {
        const skuKey = (p.SKU || '').toLowerCase();
        const stock = availMap.get(skuKey) || { AvailableStock: 0, OnOrder: 0 };
        p.AvailableStock = stock.AvailableStock;
        p.OnOrder = stock.OnOrder;
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
          AvailableStock: p.AvailableStock !== undefined ? p.AvailableStock : 0,
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

      // Sort variants inside each family A-Z by SKU
      for (const fp of groupedProducts) {
        fp.Variants.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));
      }

      // Return flat array payload
      return res.status(200).json(groupedProducts);
    } else {
      return res.status(400).json({ error: `Invalid scope: ${activeScope}` });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
