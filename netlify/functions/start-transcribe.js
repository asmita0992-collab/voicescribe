const speech = require('@google-cloud/speech');

function getCreds() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Falta la variable GOOGLE_CREDENTIALS en Netlify');
  }
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  
  let privateKey = c.private_key;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    // Aseguramos formato PEM correcto
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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { gcsUri, languageCode, model } = JSON.parse(event.body);

    const extension = gcsUri.split('.').pop().toLowerCase();
    
    // Configuración dinámica
    let encoding = 'MP3'; // Default más seguro
    let sampleRateHertz = undefined; // ¡IMPORTANTE! Dejar indefinido para que Google detecte el audio

    if (extension === 'wav') {
      encoding = 'LINEAR16';
    } else if (extension === 'flac') {
      encoding = 'FLAC';
    } else if (extension === 'ogg' || extension === 'opus') {
      encoding = 'OGG_OPUS';
    } else if (extension === 'amr') {
      encoding = 'AMR';
      sampleRateHertz = 8000; // AMR sí requiere 8000 obligatorio
    } 
    // Para MP3 y AAC (que convertiremos a MP3 mentalmente), no ponemos sampleRateHertz

    const request = {
      config: {
        languageCode: languageCode || 'es-MX',
        model: model || 'latest_long',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        encoding: encoding,
      },
      audio: { uri: gcsUri },
    };

    // Solo agregamos la frecuencia si es estrictamente necesaria (ej. AMR)
    if (sampleRateHertz) {
        request.config.sampleRateHertz = sampleRateHertz;
    }

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
