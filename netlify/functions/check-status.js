const speech = require('@google-cloud/speech');

// Función BLINDADA para leer credenciales (Asegúrate de tener esta versión exacta)
function getCreds() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Falta la variable GOOGLE_CREDENTIALS en Netlify');
  }
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  
  let privateKey = c.private_key;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----\n')) {
        privateKey = privateKey.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
    }
    if (!privateKey.includes('\n-----END PRIVATE KEY-----')) {
        privateKey = privateKey.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    }
  }

  return {
    credentials: {
      client_email: c.client_email,
      private_key: privateKey
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { operationName } = JSON.parse(event.body);
    
    // Verificamos el progreso
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
      // Esto enviará el error real al frontend
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
