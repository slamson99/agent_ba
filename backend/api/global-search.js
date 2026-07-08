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

// Tokenization Helper: splits string into lowercase individual words
function tokenize(queryStr) {
  if (!queryStr) return [];
  return queryStr.toLowerCase().split(/\s+/).filter(token => token.length > 0);
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
  const tokens = tokenize(cleanQuery);

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    if (activeScope === 'sales') {
      // BLOCK A: Customer Sales Search Pipeline (Maximized window using &limit=1000)
      const mainKeyword = tokens[0] || cleanQuery;
      let saleListUrl = `https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(mainKeyword)}&limit=1000`;
      
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

      // Filter: remove VOID/Voided and enforce Order-Independent Multi-Word Matching
      let sales = rawSales.filter(s => {
        if (s.Status && (s.Status.toUpperCase() === 'VOID' || s.Status.toUpperCase() === 'VOIDED')) {
          return false;
        }

        const customer = (s.Customer || '').toLowerCase();
        const invoiceNumber = (s.InvoiceNumber || '').toLowerCase();
        const orderNumber = (s.OrderNumber || s.SaleOrderNumber || '').toLowerCase();
        const customerRef = (s.CustomerReference || '').toLowerCase();

        return tokens.every(token =>
          customer.includes(token) ||
          invoiceNumber.includes(token) ||
          orderNumber.includes(token) ||
          customerRef.includes(token)
        );
      });

      // Sort by OrderDate descending (Newest First) across the entire matched array
      sales.sort((a, b) => {
        const da = a.OrderDate ? new Date(a.OrderDate) : new Date(0);
        const db = b.OrderDate ? new Date(b.OrderDate) : new Date(0);
        return db - da;
      });

      // Slice the top 10 items for deep hydration to avoid timeouts/429s
      const top10 = sales.slice(0, 10);
      const remaining = sales.slice(10);

      // Hydrate Sales details concurrently for the top 10 items
      const detailedTop10 = await Promise.all(top10.map(async (sale) => {
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

      // Combine detailed items with the remaining sorted items, avoiding backend slice restriction
      const fullSortedSales = [...detailedTop10, ...remaining];

      // Return flat JSON array of 1000 items
      return res.status(200).json(fullSortedSales);

    } else if (activeScope === 'products') {
      // BLOCK B: Product Search Pipeline (Order-Independent Multi-Word Search Engine)
      const mainKeyword = tokens[0] || cleanQuery;
      const [productsRes, availRes] = await Promise.allSettled([
        fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Sku=${encodeURIComponent(mainKeyword)}`, { headers }),
        fetch(`https://inventory.dearsystems.com/ExternalApi/v2/ref/productavailability?Sku=${encodeURIComponent(mainKeyword)}`, { headers })
      ]);

      let products = [];
      let availList = [];
      const jsonPromises = [];

      // Parse Products
      if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
        jsonPromises.push(productsRes.value.json().then(pData => {
          const rawProducts = pData.Products || (pData.ID || pData.SKU ? [pData] : []);
          
          // Order-Independent Catalog filter: SKU or Name must contain every single token
          products = rawProducts.filter(p => {
            const sku = (p.SKU || '').toLowerCase();
            const name = (p.Name || '').toLowerCase();
            return tokens.every(token => sku.includes(token) || name.includes(token));
          });
        }));
      }

      // Parse Availability
      if (availRes.status === 'fulfilled' && availRes.value.ok) {
        jsonPromises.push(availRes.value.json().then(data => {
          let list = [];
          if (Array.isArray(data)) {
            list = data;
          } else if (data && data.ProductAvailabilityList) {
            list = data.ProductAvailabilityList;
          } else if (data && data.ProductAvailability) {
            list = data.ProductAvailability;
          } else if (data && (data.SKU || data.Available !== undefined)) {
            list = [data];
          }
          availList = list;
        }).catch(e => console.error("Error parsing ref/productavailability JSON:", e)));
      }

      await Promise.all(jsonPromises);

      // Loop through catalog results and filter inventory to 'Main Warehouse' strictly
      const flatProductsArray = [];

      for (const p of products) {
        const mainWhRow = availList.find(a => a && a.SKU && a.SKU.toLowerCase() === (p.SKU || '').toLowerCase() && a.Location === 'Main Warehouse');

        flatProductsArray.push({
          ID: p.ID || '',
          SKU: p.SKU || 'N/A',
          Name: p.Name || 'Unnamed Product',
          Brand: p.Brand || 'N/A',
          Barcode: p.Barcode || 'N/A',
          Width: p.Width !== undefined ? p.Width : 0,
          Height: p.Height !== undefined ? p.Height : 0,
          Length: p.Length !== undefined ? p.Length : 0,
          Weight: p.Weight !== undefined ? p.Weight : 0,
          AvailableStock: (mainWhRow && mainWhRow.Available !== undefined) ? mainWhRow.Available : 0,
          OnOrder: (mainWhRow && mainWhRow.OnOrder !== undefined) ? mainWhRow.OnOrder : 0,
          PriceTier1: p.PriceTier1 !== undefined ? p.PriceTier1 : 0,
          PriceTier5: p.PriceTier5 !== undefined ? p.PriceTier5 : 0,
          SaleTaxRule: p.SaleTaxRule || 'N/A'
        });
      }

      // Sort flat list A-Z by SKU
      flatProductsArray.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));

      // Return flat array directly
      return res.status(200).json(flatProductsArray);
    } else {
      return res.status(400).json({ error: `Invalid scope: ${activeScope}` });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
