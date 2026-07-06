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
  const salesUrl = `https://inventory.dearsystems.com/ExternalApi/v2/SaleList?search=${escapedQuery}`;
  const productsUrl = `https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?Search=${escapedQuery}`;

  try {
    // Perform concurrent requests
    const [salesResult, productsResult] = await Promise.allSettled([
      fetch(salesUrl, { method: 'GET', headers }),
      fetch(productsUrl, { method: 'GET', headers })
    ]);

    let salesData: any = null;
    let productsData: any = null;
    let salesError = null;
    let productsError = null;

    // Handle Sales request result
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

    // Handle Products request result
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

    // Normalize outputs to handle either array structure or standard Cin7 response wrapper
    const sales = salesData?.SaleList || salesData?.sales || (Array.isArray(salesData) ? salesData : []);
    const products = productsData?.ProductAvailabilityList || productsData?.products || (Array.isArray(productsData) ? productsData : []);

    // Heuristic Sorting Logic
    // If the query starts with 'SO-' (case insensitive) or consists of only digits, prioritize sales
    const isSalesPattern = /^so-/i.test(query) || /^\d+$/.test(query.trim());
    const priority = isSalesPattern ? 'sales' : 'products';

    return res.status(200).json({
      query,
      priority,
      sales,
      products,
      errors: {
        sales: salesError,
        products: productsError
      }
    });

  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error occurred while processing search.",
      details: error.message || error
    });
  }
}
