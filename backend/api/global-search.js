const fetch = globalThis.fetch || (() => {
  try {
    return require('node-fetch');
  } catch (e) {
    return null;
  }
})();

module.exports = async function (req, res) {
  // 1. Force Broad CORS Handshake Headers
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
    // 2. Perform concurrent queries against official Apiary v2 endpoints
    const [productsRes, salesRes] = await Promise.allSettled([
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/ProductAvailability?Search=${encodeURIComponent(query)}`, { headers }),
      fetch(`https://inventory.dearsystems.com/ExternalApi/v2/SaleList?Search=${encodeURIComponent(query)}`, { headers })
    ]);

    let products = [];
    let sales = [];
    let priority = 'products';

    if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
      const data = await productsRes.value.json();
      products = data.ProductAvailabilityList || [];
    }
    if (salesRes.status === 'fulfilled' && salesRes.value.ok) {
      const data = await salesRes.value.json();
      sales = data.SaleList || [];
    }

    // Heuristic triage sorting rules
    if (/^[a-zA- Caring\-SO\d]+$/i.test(query) || query.toUpperCase().startsWith('SO-')) {
      priority = 'sales';
    }

    return res.status(200).json({ products, sales, priority });
  } catch (error) {
    return res.status(500).json({ error: "Failed to query Cin7 API", details: error.message });
  }
};
