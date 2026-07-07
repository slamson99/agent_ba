const fetch = require('node-fetch');

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { saleId } = req.query;
  if (!saleId) return res.status(400).json({ error: "Missing saleId parameter" });

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    const documentUrl = `https://inventory.dearsystems.com/ExternalApi/v2/Document?SaleID=${encodeURIComponent(saleId)}&Type=Invoice&TemplateName=BA+Invoice`;
    const response = await fetch(documentUrl, { headers });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errJson.error || `Cin7 returned status ${response.status}` });
    }

    const json = await response.json();
    
    // Base64 Payload Router: extract the Data field
    const base64Data = json.Data || json.Content || json.FileBytes || json.data || json.content || json.DocumentBytes;
    
    if (base64Data) {
      const pdfBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=Invoice_${saleId}.pdf`);
      return res.status(200).send(pdfBuffer);
    } else {
      return res.status(500).json({
        error: "Cin7 returned JSON but no base64 content was found in payload",
        payload: json
      });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
