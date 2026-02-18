
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech');

// Load credentials from environment variable
function getCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS no está configurada en las variables de entorno.');
  return JSON.parse(raw);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  try {
    const credentials = getCredentials();
    const projectId = credentials.project_id;

    const body = JSON.parse(event.body);
    const { audioBase64, mimeType, languageCode, model, enableAutomaticPunctuation, fileName } = body;

    if (!audioBase64) throw new Error('No se recibió audio.');

    // Init clients
    const storage = new Storage({ credentials, projectId });
    const speechClient = new SpeechClient({ credentials, projectId });

    // Create or use bucket
    const bucketName = `${projectId}-voicescribe-temp`;
    const bucket = storage.bucket(bucketName);

    // Ensure bucket exists
    const [exists] = await bucket.exists();
    if (!exists) {
      await bucket.create({ location: 'US', storageClass: 'STANDARD' });
      // Auto-delete files after 1 day
      await bucket.addLifecycleRule({
        action: { type: 'Delete' },
        condition: { age: 1 }
      });
    }

    // Upload audio to GCS
    const gcsFileName = `audio_${Date.now()}_${fileName || 'file'}`;
    const file = bucket.file(gcsFileName);
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    await file.save(audioBuffer, {
      metadata: { contentType: mimeType || 'audio/mpeg' }
    });

    const gcsUri = `gs://${bucketName}/${gcsFileName}`;

    // Detect encoding from mime type
    const encodingMap = {
      'audio/mpeg': 'MP3',
      'audio/mp3': 'MP3',
      'audio/wav': 'LINEAR16',
      'audio/x-wav': 'LINEAR16',
      'audio/flac': 'FLAC',
      'audio/x-flac': 'FLAC',
      'audio/ogg': 'OGG_OPUS',
      'audio/opus': 'OGG_OPUS',
      'audio/aac': 'MP3',
      'audio/x-aac': 'MP3',
      'audio/m4a': 'MP3',
      'audio/x-m4a': 'MP3',
      'audio/amr': 'AMR',
      'audio/webm': 'WEBM_OPUS',
    };

    const encoding = encodingMap[mimeType] || 'MP3';

    // Build recognition config
    const config = {
      languageCode: languageCode || 'es-MX',
      model: model || 'latest_long',
      enableAutomaticPunctuation: enableAutomaticPunctuation !== false,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      encoding,
    };

    // Add sample rate only when needed
    if (['MP3', 'LINEAR16', 'AMR'].includes(encoding)) {
      config.sampleRateHertz = encoding === 'AMR' ? 8000 : 16000;
    }

    // Start long running recognition
    const [operation] = await speechClient.longRunningRecognize({
      config,
      audio: { uri: gcsUri }
    });

    // Wait for completion (up to 10 min)
    const [response] = await operation.promise({ timeout: 600000 });

    // Clean up GCS file
    try { await file.delete(); } catch (_) {}

    // Process results
    let fullText = '';
    let totalConfidence = 0;
    let confCount = 0;
    let allWords = [];

    for (const result of (response.results || [])) {
      const alt = result.alternatives[0];
      if (alt.transcript) fullText += alt.transcript + ' ';
      if (alt.confidence) { totalConfidence += alt.confidence; confCount++; }
      if (alt.words) allWords = allWords.concat(alt.words.map(w => ({
        word: w.word,
        startTime: w.startTime?.seconds + (w.startTime?.nanos || 0) / 1e9 + 's',
        endTime: w.endTime?.seconds + (w.endTime?.nanos || 0) / 1e9 + 's',
        confidence: w.confidence,
      })));
    }

    if (!fullText.trim()) throw new Error('No se detectó voz en el archivo.');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text: fullText.trim(),
        confidence: confCount > 0 ? totalConfidence / confCount : null,
        words: allWords,
      })
    };

  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Error interno del servidor' })
    };
  }
};
