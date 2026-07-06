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

  const { saleId, documentType } = req.query;

  if (!saleId || typeof saleId !== 'string' || !documentType || typeof documentType !== 'string') {
    return res.status(400).json({ error: "Missing or invalid saleId or documentType query parameters." });
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
    'Accept': 'application/json, application/pdf'
  };

  const escapedSaleId = encodeURIComponent(saleId);
  const escapedType = encodeURIComponent(documentType);
  const documentUrl = `https://inventory.dearsystems.com/ExternalApi/v2/sale/document?SaleID=${escapedSaleId}&Type=${escapedType}`;

  try {
    const cin7Response = await fetch(documentUrl, {
      method: 'GET',
      headers
    });

    if (!cin7Response.ok) {
      const errorText = await cin7Response.text();
      return res.status(cin7Response.status).json({
        error: `Cin7 Document API returned error status ${cin7Response.status}`,
        details: errorText
      });
    }

    const contentType = cin7Response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = (await cin7Response.json()) as any;
      // Handle base64 encoded document content if wrapped in JSON
      const base64Data = json.Content || json.FileBytes || json.data || json.content;
      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${documentType.replace(/\s+/g, '_')}_${saleId}.pdf"`);
        return res.status(200).send(buffer);
      } else {
        // Fallback if JSON format but no recognizable base64 field found
        return res.status(500).json({
          error: "Cin7 API returned a JSON response but no base64 document content was identified.",
          payload: json
        });
      }
    } else {
      // Stream raw binary PDF directly
      const arrayBuffer = await cin7Response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${documentType.replace(/\s+/g, '_')}_${saleId}.pdf"`);
      return res.status(200).send(buffer);
    }

  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error occurred while retrieving document.",
      details: error.message || error
    });
  }
}
