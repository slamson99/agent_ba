const https = require('https');

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { saleId, documentType } = req.query;
  if (!saleId || !documentType) return res.status(400).json({ error: "Missing parameters" });

  const headers = {
    'api-auth-accountid': process.env.CIN7_ACCOUNT_ID,
    'api-auth-applicationkey': process.env.CIN7_API_KEY || process.env.CIN7_APPLICATION_KEY
  };

  const documentUrl = `https://inventory.dearsystems.com/ExternalApi/v2/Document?SaleID=${saleId}&Type=${encodeURIComponent(documentType)}`;

  try {
    https.get(documentUrl, { headers }, (response) => {
      if (response.statusCode === 404) {
        return res.status(404).json({ error: "Document not found on Cin7 Core" });
      }
      if (response.statusCode >= 300) {
        return res.status(response.statusCode).json({ error: `Cin7 returned status ${response.statusCode}` });
      }

      const contentType = response.headers['content-type'] || '';
      const chunks = [];

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        
        if (contentType.includes('application/json')) {
          try {
            const json = JSON.parse(buffer.toString('utf8'));
            const base64Data = json.Content || json.FileBytes || json.data || json.content || json.DocumentBytes;
            if (base64Data) {
              const pdfBuffer = Buffer.from(base64Data, 'base64');
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="${documentType.replace(/\s+/g, '_')}_${saleId}.pdf"`);
              return res.status(200).send(pdfBuffer);
            } else {
              return res.status(500).json({
                error: "Cin7 returned JSON but no base64 content was found in payload",
                payload: json
              });
            }
          } catch (e) {
            return res.status(500).json({ error: "Failed to parse JSON response from Cin7", details: e.message });
          }
        } else {
          // Send raw binary PDF directly
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${documentType.replace(/\s+/g, '_')}_${saleId}.pdf"`);
          return res.status(200).send(buffer);
        }
      });
    }).on('error', (err) => {
      return res.status(500).json({ error: "Connection to Cin7 API failed", details: err.message });
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to process document request", details: error.message });
  }
};
