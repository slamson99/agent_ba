import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const query = req.query.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: "Missing or invalid search query parameter." });
  }

  const accountId = process.env.CIN7_ACCOUNT_ID;
  const apiKey = process.env.CIN7_APPLICATION_KEY;

  if (!accountId || !apiKey) {
    return res.status(500).json({
      error: "Cin7 API credentials are not configured on the server."
    });
  }

  const headers = {
    'api-auth-accountid': accountId,
    'api-auth-applicationkey': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const escapedQuery = encodeURIComponent(query);
  
  // Strict Cin7 Core V2 Base Paths
  const salesUrl = `https://inventory.dearsystems.com/ExternalApi/v2/sale/list?Search=${escapedQuery}`;
  const productsUrl = `https://inventory.dearsystems.com/ExternalApi/v2/inventory/productAvailability?Search=${escapedQuery}`;
  const customersUrl = `https://inventory.dearsystems.com/ExternalApi/v2/customer?Name=${escapedQuery}`;

  try {
    // Perform concurrent requests across all three endpoints
    const [salesResult, productsResult, customersResult] = await Promise.allSettled([
      fetch(salesUrl, { method: 'GET', headers }),
      fetch(productsUrl, { method: 'GET', headers }),
      fetch(customersUrl, { method: 'GET', headers })
    ]);

    let salesData: any = null;
    let productsData: any = null;
    let customersData: any = null;
    let salesError = null;
    let productsError = null;
    let customersError = null;

    // Handle Sales response
    if (salesResult.status === 'fulfilled') {
      const response = salesResult.value;
      if (response.ok) {
        salesData = await response.json();
      } else {
        const text = await response.text();
        salesError = `Cin7 SaleList API returned status ${response.status}: ${text}`;
      }
    } else {
      salesError = salesResult.reason?.message || "Unknown error fetching Sales list";
    }

    // Handle Products response
    if (productsResult.status === 'fulfilled') {
      const response = productsResult.value;
      if (response.ok) {
        productsData = await response.json();
      } else {
        const text = await response.text();
        productsError = `Cin7 ProductAvailability API returned status ${response.status}: ${text}`;
      }
    } else {
      productsError = productsResult.reason?.message || "Unknown error fetching Product Availability";
    }

    // Handle Customers response
    if (customersResult.status === 'fulfilled') {
      const response = customersResult.value;
      if (response.ok) {
        customersData = await response.json();
      } else {
        const text = await response.text();
        customersError = `Cin7 Customer API returned status ${response.status}: ${text}`;
      }
    } else {
      customersError = customersResult.reason?.message || "Unknown error fetching Customers list";
    }

    // Normalize arrays from Cin7 REST structures
    const sales = salesData?.SaleList || salesData?.sales || (Array.isArray(salesData) ? salesData : []);
    const products = productsData?.ProductAvailabilityList || productsData?.products || (Array.isArray(productsData) ? productsData : []);
    const customers = customersData?.CustomerList || customersData?.customers || (Array.isArray(customersData) ? customersData : []);

    // Heuristic Sorting Logic: Prioritize sales if it looks like a Sales Order reference (e.g. starts with 'SO-' or only digits)
    const isSalesPattern = /^so-/i.test(query) || /^\d+$/.test(query.trim());
    const priority = isSalesPattern ? 'sales' : 'products';

    return res.status(200).json({
      query,
      priority,
      sales,
      products,
      customers,
      errors: {
        sales: salesError,
        products: productsError,
        customers: customersError
      }
    });

  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error occurred while processing global search.",
      details: error.message || error
    });
  }
}
