const https = require('https');
const urlModule = require('url');

function followRedirects(targetUrl, headers, depth = 0) {
  if (depth > 3) {
    return Promise.reject(new Error("Too many redirects followed"));
  }
  return new Promise((resolve, reject) => {
    const parsed = urlModule.parse(targetUrl);
    const client = parsed.protocol === 'http:' ? require('http') : https;
    
    client.get(targetUrl, { headers }, (response) => {
      // Check for redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        let redirectUrl = response.headers.location;
        if (redirectUrl) {
          // Resolve relative redirect URLs
          if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
            const protocol = parsed.protocol;
            const host = parsed.host;
            redirectUrl = `${protocol}//${host}${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`;
          }
          // Drop headers for external storage domains like AWS S3
          const isExternal = !redirectUrl.includes('dearsystems.com');
          const nextHeaders = isExternal ? {} : headers;
          
          followRedirects(redirectUrl, nextHeaders, depth + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
      }

      const chunks = [];
      response.on('data', (chunk) => { chunks.push(chunk); });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          buffer: Buffer.concat(chunks)
        });
      });
    }).on('error', reject);
  });
}

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

  // Adjust URL matching for Invoice type template syncing
  let documentUrl;
  if (documentType === 'Invoice' || documentType === 'invoice') {
    documentUrl = `https://inventory.dearsystems.com/ExternalApi/v2/Document?SaleID=${saleId}&Type=Invoice&TemplateName=BA+Invoice`;
  } else {
    documentUrl = `https://inventory.dearsystems.com/ExternalApi/v2/Document?SaleID=${saleId}&Type=${encodeURIComponent(documentType)}`;
  }

  try {
    const result = await followRedirects(documentUrl, headers);
    
    if (result.statusCode === 404) {
      return res.status(404).json({ error: "Document not found on Cin7 Core" });
    }
    if (result.statusCode >= 300) {
      return res.status(result.statusCode).json({ error: `Cin7 returned status ${result.statusCode}` });
    }

    const contentType = result.headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      try {
        const json = JSON.parse(result.buffer.toString('utf8'));
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
      return res.status(200).send(result.buffer);
    }
  } catch (error) {
    return res.status(500).json({ error: "Failed to process document request", details: error.message });
  }
};
