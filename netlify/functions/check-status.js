const speech = require('@google-cloud/speech');

function getCreds() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Falta la variable GOOGLE_CREDENTIALS en Netlify');
  }
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return {
    credentials: {
      client_email: c.client_email,
      private_key: c.private_key.split(String.raw`\n`).join('\n').replace(/\\n/g, '\n')
    },
    projectId: c.project_id
  };
}

const client = new speech.SpeechClient(getCreds());

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { operationName } = JSON.parse(event.body);
    const [operation] = await client.checkLongRunningRecognizeProgress(operationName);

    if (operation.done) {
      const [response] = await operation.promise();
      
      let fullText = "";
      let words = [];
      let totalConf = 0;
      let count = 0;

      if (response.results) {
        fullText = response.results
          .map(r => r.alternatives[0].transcript)
          .join(' ');
          
        response.results.forEach(r => {
            const alt = r.alternatives[0];
            if (alt.words) words.push(...alt.words);
            if (alt.confidence) { totalConf += alt.confidence; count++; }
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
            status: 'DONE', 
            text: fullText, 
            confidence: count > 0 ? totalConf / count : 0,
            words: words 
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'PROCESSING' }) };
    
  } catch (error) {
    console.error("Error en check-status:", error);
    return { 
      statusCode: 500, 
      headers,
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
