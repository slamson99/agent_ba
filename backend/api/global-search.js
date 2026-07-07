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
  // Global CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, scope } = req.query;
  if (!query) return res.status(400).json({ error: "Missing query parameter" });

  // Case-Insensitive sync lowercase cast
  const lowercaseQuery = query.toLowerCase();

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    const queryProducts = !scope || scope === 'products';
    const querySales = !scope || scope === 'sales';

    // Fetch availability and catalog details concurrently
    const [productsRes, availabilityRes, salesRes] = await Promise.allSettled([
      queryProducts 
        ? httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Product?Search=${encodeURIComponent(lowercaseQuery)}`, headers)
        : Promise.resolve({ ok: true, json: async () => ({ Products: [] }) }),
      queryProducts
        ? httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?Search=${encodeURIComponent(lowercaseQuery)}`, headers)
        : Promise.resolve({ ok: true, json: async () => ({ ProductAvailabilityList: [] }) }),
      querySales
        ? httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(lowercaseQuery)}`, headers)
        : Promise.resolve({ ok: true, json: async () => ({ SaleList: [] }) })
    ]);

    let products = [];
    let sales = [];
    let priority = 'products';

    // Merge catalog details and availability metrics
    const availabilityMap = {};
    if (availabilityRes.status === 'fulfilled' && availabilityRes.value.ok) {
      try {
        const availData = await availabilityRes.value.json();
        const list = availData.ProductAvailabilityList || [];
        list.forEach(item => {
          if (item && item.SKU) {
            availabilityMap[item.SKU.toLowerCase()] = item;
          }
        });
      } catch (e) {
        console.error("Failed to parse availability map:", e);
      }
    }

    // 1. Fetch detailed product catalog information if there are any results
    if (queryProducts && productsRes.status === 'fulfilled' && productsRes.value.ok) {
      const data = await productsRes.value.json();
      const rawProducts = data.Products || [];
      
      // Limit to top 5 detailed fetches to prevent rate limiting
      const detailedProductsPromises = rawProducts.slice(0, 5).map(async (prod) => {
        try {
          const productId = prod.ID || prod.ProductID || '';
          const detailRes = await httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Product?ID=${productId}`, headers);
          if (detailRes.ok) {
            const productDetails = await detailRes.json();
            
            // Extract BOM Components if active or true (with defensive empty fallbacks)
            let bomComponents = [];
            if (productDetails && (productDetails.BillOfMaterials === true || productDetails.BillOfMaterials === 'true' || productDetails.BOM)) {
              const bom = productDetails.BOM || productDetails.BillOfMaterials || {};
              const lines = bom.Lines || bom.Components || bom.LinesList || [];
              if (Array.isArray(lines)) {
                bomComponents = lines.map(line => {
                  if (!line) return null;
                  return {
                    SKU: line.ComponentSKU || line.SKU || line.ProductSKU || '',
                    Quantity: line.Quantity || line.Qty || 0,
                    Name: line.Name || line.ComponentName || ''
                  };
                }).filter(comp => comp && comp.SKU);
              }
            }

            // Extract family parameters if present
            let family = null;
            if (productDetails && (productDetails.ProductFamily || productDetails.ProductFamilyID || productDetails.ProductFamilySKU)) {
              family = {
                ID: productDetails.ProductFamilyID || '',
                Name: productDetails.ProductFamily || '',
                SKU: productDetails.ProductFamilySKU || ''
              };
            }

            const skuLower = (prod.SKU || productDetails.SKU || '').toLowerCase();
            const availItem = availabilityMap[skuLower] || {};

            return {
              ID: productId || prod.ID || '',
              SKU: prod.SKU || productDetails.SKU || 'N/A',
              Name: prod.Name || productDetails.Name || 'Unnamed Product',
              Brand: productDetails.Brand || 'N/A',
              OnHand: availItem.OnHand !== undefined ? availItem.OnHand : 0,
              Allocated: availItem.Allocated !== undefined ? availItem.Allocated : 0,
              OnOrder: availItem.OnOrder !== undefined ? availItem.OnOrder : (productDetails.OnOrder !== undefined ? productDetails.OnOrder : 0),
              Barcode: productDetails.Barcode || 'N/A',
              Length: productDetails.Length !== undefined ? productDetails.Length : 0,
              Width: productDetails.Width !== undefined ? productDetails.Width : 0,
              Height: productDetails.Height !== undefined ? productDetails.Height : 0,
              Weight: productDetails.Weight !== undefined ? productDetails.Weight : 0,
              BOM: bomComponents.length > 0 ? bomComponents : null,
              Family: family
            };
          }
        } catch (err) {
          console.error(`Failed to fetch product details for ${prod.ID || prod.ProductID}:`, err);
        }
        
        // Fallback to basic availability data if detailed fetch fails
        const skuLower = (prod.SKU || '').toLowerCase();
        const availItem = availabilityMap[skuLower] || {};
        return {
          ID: prod.ID || prod.ProductID,
          SKU: prod.SKU || 'N/A',
          Name: prod.Name || 'Unnamed Product',
          Brand: 'N/A',
          OnHand: availItem.OnHand !== undefined ? availItem.OnHand : 0,
          Allocated: availItem.Allocated !== undefined ? availItem.Allocated : 0,
          OnOrder: availItem.OnOrder !== undefined ? availItem.OnOrder : 0,
          Barcode: 'N/A',
          Length: 0,
          Width: 0,
          Height: 0,
          Weight: 0,
          BOM: null,
          Family: null
        };
      });
      
      products = await Promise.all(detailedProductsPromises);
    }

    // 2. Fetch detailed sales information if there are any search results
    if (querySales && salesRes.status === 'fulfilled' && salesRes.value.ok) {
      const data = await salesRes.value.json();
      const rawSales = data.SaleList || [];
      
      // Limit to top 5 detailed fetches to ensure performance and prevent rate limiting
      const detailedSalesPromises = rawSales.slice(0, 5).map(async (sale) => {
        try {
          const saleId = sale.SaleID || sale.ID || '';
          
          // Concurrently fetch Sale Details AND Fulfilment Payload to resolve tracking details
          const [detailRes, fulfilmentRes] = await Promise.allSettled([
            httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Sale?ID=${saleId}`, headers),
            httpsGet(`https://inventory.dearsystems.com/ExternalApi/v2/Sale/Fulfilment?TaskID=${saleId}`, headers)
          ]);
          
          if (detailRes.status === 'fulfilled' && detailRes.value.ok) {
            const saleDetails = await detailRes.value.json();
            
            // Extract tracking & shipping details from both payloads defensively
            let trackingNumbers = [];
            let shippingNotesList = [];
            
            // Traversal 1: Details payload
            const fulfillments = saleDetails.Fulfillments || saleDetails.Fulfillment || [];
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

            // Traversal 2: Hydrated Fulfilment payload (traverse deeply: Fulfilment -> Shipment -> Lines)
            if (fulfilmentRes.status === 'fulfilled' && fulfilmentRes.value.ok) {
              try {
                const fData = await fulfilmentRes.value.json();
                if (fData) {
                  const fList = fData.Fulfillments || fData.Fulfillment || fData.FulfillmentsList || [];
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
                }
              } catch (e) {
                console.error("Failed to parse hydrated Sale/Fulfilment details:", e);
              }
            }

            // Extract invoice & payment details
            const invoices = saleDetails.Invoices || saleDetails.Invoice || [];
            let invoiceNumber = 'N/A';
            let invoiceAmount = 0;
            let invoiceDueDate = 'N/A';
            let paymentStatus = 'UNPAID';

            const invoiceArr = Array.isArray(invoices) ? invoices : (invoices ? [invoices] : []);
            if (invoiceArr.length > 0) {
              const primaryInvoice = invoiceArr[0];
              if (primaryInvoice) {
                invoiceNumber = primaryInvoice.InvoiceNumber || 'N/A';
                invoiceAmount = primaryInvoice.Total || primaryInvoice.InvoiceTotal || 0;
                invoiceDueDate = formatDate(primaryInvoice.DueDate || primaryInvoice.InvoiceDueDate || primaryInvoice.InvoiceDate);
                
                // Evaluate payment status
                const invStatus = (primaryInvoice.Status || '').toUpperCase();
                const balanceDue = primaryInvoice.BalanceDue !== undefined 
                  ? primaryInvoice.BalanceDue 
                  : (invoiceAmount - (primaryInvoice.Paid || 0));
                
                if (invStatus === 'PAID' || balanceDue <= 0) {
                  paymentStatus = 'PAID';
                } else if (invStatus === 'PARTIALLY PAID' || (balanceDue > 0 && balanceDue < invoiceAmount)) {
                  paymentStatus = 'PARTIALLY PAID';
                } else {
                  paymentStatus = 'UNPAID';
                }
              }
            }

            // Mirror AdditionalAttribute6 from root Sale layout
            const additionalAttribute6 = saleDetails.AdditionalAttribute6 || (saleDetails.AdditionalAttributes && saleDetails.AdditionalAttributes.AdditionalAttribute6) || 'N/A';

            return {
              ID: saleId || saleDetails.ID || '',
              OrderNumber: sale.OrderNumber || saleDetails.OrderNumber || 'Unassigned',
              OrderDate: formatDate(saleDetails.OrderDate || saleDetails.Created || sale.OrderDate),
              Status: saleDetails.Status || sale.Status || 'Draft',
              Customer: saleDetails.Customer || sale.Customer || 'Unknown Customer',
              Email: saleDetails.Email || saleDetails.ContactEmail || 'N/A',
              SalesRepresentative: saleDetails.SalesRepresentative || saleDetails.SalesPerson || 'N/A',
              Discount: saleDetails.Discount || saleDetails.DiscountPercent || 0,
              AdditionalAttribute6: additionalAttribute6,
              InvoiceNumber: invoiceNumber,
              CustomerReference: saleDetails.CustomerReference || saleDetails.Reference || 'N/A',
              InvoiceAmount: invoiceAmount,
              InvoiceDueDate: invoiceDueDate,
              PaymentStatus: paymentStatus,
              FulFilmentStatus: saleDetails.FulfillmentStatus || saleDetails.Status || 'N/A',
              CombinedTrackingNumbers: trackingNumbers.filter((v, i, a) => a.indexOf(v) === i && v).join(', ') || 'N/A',
              ShippingNotes: shippingNotesList.filter((v, i, a) => a.indexOf(v) === i && v).join('; ') || 'N/A'
            };
          }
        } catch (err) {
          console.error(`Failed to fetch sale details for ${sale.SaleID || sale.ID}:`, err);
        }
        
        // Fallback to basic list data if detailed fetch fails
        return {
          ID: sale.SaleID || sale.ID,
          OrderNumber: sale.OrderNumber || 'Unassigned',
          OrderDate: formatDate(sale.OrderDate),
          Status: sale.Status || 'Draft',
          Customer: sale.Customer || 'Unknown Customer',
          Email: 'N/A',
          SalesRepresentative: 'N/A',
          Discount: 0,
          AdditionalAttribute6: 'N/A',
          InvoiceNumber: 'N/A',
          CustomerReference: 'N/A',
          InvoiceAmount: 0,
          InvoiceDueDate: 'N/A',
          PaymentStatus: 'UNPAID',
          FulFilmentStatus: sale.Status || 'N/A',
          CombinedTrackingNumbers: 'N/A',
          ShippingNotes: 'N/A'
        };
      });
      
      sales = await Promise.all(detailedSalesPromises);
    }

    // Voided Filtering Block: Strip out any transactions where Status is Void/Voided
    sales = sales.filter(s => {
      const status = (s.Status || '').toUpperCase();
      return status !== 'VOID' && status !== 'VOIDED';
    });

    if (scope) {
      priority = scope;
    } else if (lowercaseQuery.startsWith('so-') || /^\d+$/.test(lowercaseQuery)) {
      priority = 'sales';
    }

    return res.status(200).json({ products, sales, priority });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Cin7 Request Failure" });
  }
};
