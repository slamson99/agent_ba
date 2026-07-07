const https = require('https');

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (response) => {
      let rawData = '';
      response.on('data', (chunk) => { rawData += chunk; });
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: async () => {
            try {
              return JSON.parse(rawData);
            } catch (e) {
              throw new Error(`Failed to parse response JSON: ${rawData.substring(0, 150)}`);
            }
          }
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = async function (req, res) {
  // Global CORS headers
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
    // Query exact paths derived from official Cin7 documentation using native client
    const [productsRes, salesRes] = await Promise.allSettled([
      httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?Search=${encodeURIComponent(query)}`, headers),
      httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(query)}`, headers)
    ]);

    let products = [];
    let sales = [];
    let priority = 'products';

    // 1. Fetch detailed product catalog information if there are any results
    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      const data = await productsRes.value.json();
      const rawProducts = data.ProductAvailabilityList || [];
      
      // Limit to top 5 detailed fetches to prevent rate limiting
      const detailedProductsPromises = rawProducts.slice(0, 5).map(async (prod) => {
        try {
          const detailRes = await httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Product?ID=${prod.ID}`, headers);
          if (detailRes.ok) {
            const productDetails = await detailRes.json();
            
            // Extract BOM Components if present
            let bomComponents = [];
            const bom = productDetails.BOM || productDetails.BillOfMaterials || {};
            const lines = bom.Lines || bom.Components || bom.LinesList || [];
            if (Array.isArray(lines)) {
              bomComponents = lines.map(line => ({
                SKU: line.ComponentSKU || line.SKU || line.ProductSKU || '',
                Quantity: line.Quantity || line.Qty || 0
              })).filter(comp => comp.SKU);
            }

            return {
              ID: prod.ID || productDetails.ID || '',
              SKU: prod.SKU || productDetails.SKU || 'N/A',
              Name: prod.Name || productDetails.Name || 'Unnamed Product',
              Brand: productDetails.Brand || 'N/A',
              OnHand: prod.OnHand !== undefined ? prod.OnHand : 0,
              Allocated: prod.Allocated !== undefined ? prod.Allocated : 0,
              OnOrder: prod.OnOrder !== undefined ? prod.OnOrder : 0,
              Barcode: productDetails.Barcode || 'N/A',
              Length: productDetails.Length !== undefined ? productDetails.Length : 0,
              Width: productDetails.Width !== undefined ? productDetails.Width : 0,
              Height: productDetails.Height !== undefined ? productDetails.Height : 0,
              Weight: productDetails.Weight !== undefined ? productDetails.Weight : 0,
              BOM: bomComponents.length > 0 ? bomComponents : null
            };
          }
        } catch (err) {
          console.error(`Failed to fetch product details for ${prod.ID}:`, err);
        }
        
        // Fallback to basic availability data if detailed fetch fails
        return {
          ID: prod.ID,
          SKU: prod.SKU || 'N/A',
          Name: prod.Name || 'Unnamed Product',
          Brand: 'N/A',
          OnHand: prod.OnHand !== undefined ? prod.OnHand : 0,
          Allocated: prod.Allocated !== undefined ? prod.Allocated : 0,
          OnOrder: prod.OnOrder !== undefined ? prod.OnOrder : 0,
          Barcode: 'N/A',
          Length: 0,
          Width: 0,
          Height: 0,
          Weight: 0,
          BOM: null
        };
      });
      
      products = await Promise.all(detailedProductsPromises);
    }

    // 2. Fetch detailed sales information if there are any search results
    if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
      const data = await salesRes.value.json();
      const rawSales = data.SaleList || [];
      
      // Limit to top 5 detailed fetches to ensure performance and prevent rate limiting
      const detailedSalesPromises = rawSales.slice(0, 5).map(async (sale) => {
        try {
          const detailRes = await httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Sale?ID=${sale.ID}`, headers);
          if (detailRes.ok) {
            const saleDetails = await detailRes.json();
            
            // Extract tracking & shipping details
            let trackingNumbers = [];
            let shippingNotesList = [];
            const fulfillments = saleDetails.Fulfillments || saleDetails.Fulfillment || [];
            if (Array.isArray(fulfillments)) {
              fulfillments.forEach(f => {
                const ship = f.Ship || f.Shipment || {};
                if (ship.Lines && Array.isArray(ship.Lines)) {
                  ship.Lines.forEach(l => {
                    if (l.TrackingNumber) trackingNumbers.push(l.TrackingNumber);
                  });
                }
                if (ship.TrackingNumber) {
                  trackingNumbers.push(ship.TrackingNumber);
                }
                if (ship.Notes || ship.ShippingNotes || ship.Comment) {
                  shippingNotesList.push(ship.Notes || ship.ShippingNotes || ship.Comment);
                }
              });
            }

            // Extract invoice details
            const invoices = saleDetails.Invoices || saleDetails.Invoice || [];
            let invoiceNumber = 'N/A';
            let invoiceAmount = 0;
            if (Array.isArray(invoices) && invoices.length > 0) {
              invoiceNumber = invoices[0].InvoiceNumber || 'N/A';
              invoiceAmount = invoices[0].Total || invoices[0].InvoiceTotal || 0;
            } else if (invoices && typeof invoices === 'object') {
              invoiceNumber = invoices.InvoiceNumber || 'N/A';
              invoiceAmount = invoices.Total || invoices.InvoiceTotal || 0;
            }

            return {
              ID: sale.ID || saleDetails.ID || '',
              OrderNumber: sale.OrderNumber || saleDetails.OrderNumber || 'Unassigned',
              Status: saleDetails.Status || sale.Status || 'Draft',
              Customer: saleDetails.Customer || sale.Customer || 'Unknown Customer',
              Email: saleDetails.Email || saleDetails.ContactEmail || 'N/A',
              SalesRepresentative: saleDetails.SalesRepresentative || saleDetails.SalesPerson || 'N/A',
              Discount: saleDetails.Discount || saleDetails.DiscountPercent || 0,
              AdditionalAttribute6: saleDetails.AdditionalAttribute6 || 'N/A',
              InvoiceNumber: invoiceNumber,
              CustomerReference: saleDetails.CustomerReference || saleDetails.Reference || 'N/A',
              InvoiceAmount: invoiceAmount,
              FulFilmentStatus: saleDetails.FulfillmentStatus || saleDetails.Status || 'N/A',
              CombinedTrackingNumbers: trackingNumbers.filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'N/A',
              ShippingNotes: shippingNotesList.filter((v, i, a) => a.indexOf(v) === i && v).join('; ') || 'N/A'
            };
          }
        } catch (err) {
          console.error(`Failed to fetch sale details for ${sale.ID}:`, err);
        }
        
        // Fallback to basic list data if detailed fetch fails
        return {
          ID: sale.ID,
          OrderNumber: sale.OrderNumber || 'Unassigned',
          Status: sale.Status || 'Draft',
          Customer: sale.Customer || 'Unknown Customer',
          Email: 'N/A',
          SalesRepresentative: 'N/A',
          Discount: 0,
          AdditionalAttribute6: 'N/A',
          InvoiceNumber: 'N/A',
          CustomerReference: 'N/A',
          InvoiceAmount: 0,
          FulFilmentStatus: sale.Status || 'N/A',
          CombinedTrackingNumbers: 'N/A',
          ShippingNotes: 'N/A'
        };
      });
      
      sales = await Promise.all(detailedSalesPromises);
    }

    if (query.toUpperCase().startsWith('SO-') || /^\d+$/.test(query)) {
      priority = 'sales';
    }

    return res.status(200).json({ products, sales, priority });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Cin7 Request Failure" });
  }
};
