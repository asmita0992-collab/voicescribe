const speech = require('@google-cloud/speech');

function getCreds() {
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return {
    credentials: { client_email: c.client_email, private_key: c.private_key },
    projectId: c.project_id
  };
}

const client = new speech.SpeechClient(getCreds());

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { operationName } = JSON.parse(event.body);
    const [operation] = await client.checkLongRunningRecognizeProgress(operationName);

    if (operation.done) {
      const [response] = await operation.promise();
      
      // Procesar texto completo
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
        body: JSON.stringify({ 
            status: 'DONE', 
            text: fullText, 
            confidence: count > 0 ? totalConf / count : 0,
            words: words 
        }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'PROCESSING' }) };
    
  } catch (error) {
    console.error("Error en check-status:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
