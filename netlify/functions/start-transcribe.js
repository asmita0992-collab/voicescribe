
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
    const { gcsUri, languageCode, model } = JSON.parse(event.body);

    const request = {
      config: {
        languageCode: languageCode || 'es-MX',
        model: model || 'latest_long',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        // Al no especificar encoding, Google intentará detectarlo (funciona para WAV/FLAC/MP3 en v2)
      },
      audio: { uri: gcsUri },
    };

    // Usamos longRunningRecognize para soportar archivos de horas de duración
    const [operation] = await client.longRunningRecognize(request);

    return {
      statusCode: 200,
      body: JSON.stringify({ operationName: operation.name }),
    };
  } catch (error) {
    console.error("Error en start-transcribe:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
