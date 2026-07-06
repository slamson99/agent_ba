export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { saleId, documentType } = req.query;
  if (!saleId || !documentType) return res.status(400).json({ error: "Missing parameters" });

  try {
    const response = await fetch(`https://inventory.dearsystems.com/ExternalApi/v2/Document?SaleID=${saleId}&Type=${encodeURIComponent(documentType)}`, {
      headers: {
        'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
        'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY
      }
    });

    if (!response.ok) throw new Error(`Cin7 document query returned status ${response.status}`);
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to download document", details: error.message });
  }
}
