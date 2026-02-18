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
    const { gcsUri, languageCode, model } = JSON.parse(event.body);

    const request = {
      config: {
        languageCode: languageCode || 'es-MX',
        model: model || 'latest_long',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        // Al no especificar encoding, Google V2 lo detecta automáticamente (WAV/FLAC/MP3)
      },
      audio: { uri: gcsUri },
    };

    // Usamos longRunningRecognize para soportar archivos largos
    const [operation] = await client.longRunningRecognize(request);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ operationName: operation.name }),
    };
  } catch (error) {
    console.error("Error en start-transcribe:", error);
    return { 
      statusCode: 500, 
      headers,
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
