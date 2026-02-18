const { createSign } = require('crypto');

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(credentials.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${header}.${payload}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('No se pudo obtener access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function uploadToGCS(token, projectId, audioBuffer, fileName) {
  const bucketName = `${projectId}-voicescribe-temp`;
  await fetch(`https://storage.googleapis.com/storage/v1/b?project=${projectId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: bucketName, lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: 1 } }] } }),
  });
  const gcsFileName = `audio_${Date.now()}_${fileName}`;
  const uploadRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${encodeURIComponent(gcsFileName)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: audioBuffer }
  );
  if (!uploadRes.ok) throw new Error('Error subiendo a GCS: ' + await uploadRes.text());
  return { bucketName, gcsFileName, gcsUri: `gs://${bucketName}/${gcsFileName}` };
}

async function deleteFromGCS(token, bucketName, fileName) {
  await fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(fileName)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

async function transcribeAudio(token, gcsUri, config) {
  const startRes = await fetch('https://speech.googleapis.com/v1/speech:longrunningrecognize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, audio: { uri: gcsUri } }),
  });
  if (!startRes.ok) throw new Error('Error iniciando transcripción: ' + await startRes.text());
  const operation = await startRes.json();
  const opName = operation.name;
  const start = Date.now();
  while (Date.now() - start < 540000) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://speech.googleapis.com/v1/operations/${opName}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const status = await pollRes.json();
    if (status.error) throw new Error('Error en operación: ' + JSON.stringify(status.error));
    if (status.done) return status.response;
  }
  throw new Error('Timeout: la transcripción tardó demasiado.');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };

  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const projectId = credentials.project_id;
    const body = JSON.parse(event.body);
    const { audioBase64, mimeType, fileName, languageCode, model, enableAutomaticPunctuation } = body;
    if (!audioBase64) throw new Error('No se recibió audio.');

    const token = await getAccessToken(credentials);
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const { bucketName, gcsFileName, gcsUri } = await uploadToGCS(token, projectId, audioBuffer, fileName || 'audio');

    const encodingMap = {
      'audio/mpeg': 'MP3', 'audio/mp3': 'MP3',
      'audio/wav': 'LINEAR16', 'audio/x-wav': 'LINEAR16',
      'audio/flac': 'FLAC', 'audio/x-flac': 'FLAC',
      'audio/ogg': 'OGG_OPUS', 'audio/opus': 'OGG_OPUS',
      'audio/aac': 'MP3', 'audio/x-aac': 'MP3',
      'audio/m4a': 'MP3', 'audio/x-m4a': 'MP3',
      'audio/amr': 'AMR', 'audio/webm': 'WEBM_OPUS',
    };
    const encoding = encodingMap[mimeType] || 'MP3';
    const config = {
      languageCode: languageCode || 'es-MX',
      model: model || 'latest_long',
      enableAutomaticPunctuation: enableAutomaticPunctuation !== false,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      encoding,
    };
    if (['MP3', 'LINEAR16', 'AMR'].includes(encoding)) {
      config.sampleRateHertz = encoding === 'AMR' ? 8000 : 16000;
    }

    const response = await transcribeAudio(token, gcsUri, config);
    await deleteFromGCS(token, bucketName, gcsFileName);

    let fullText = '', totalConf = 0, confCount = 0, allWords = [];
    for (const result of (response.results || [])) {
      const alt = result.alternatives[0];
      if (alt.transcript) fullText += alt.transcript + ' ';
      if (alt.confidence) { totalConf += alt.confidence; confCount++; }
      if (alt.words) allWords = allWords.concat(alt.words.map(w => ({
        word: w.word,
        startTime: (w.startTime?.seconds || 0) + (w.startTime?.nanos || 0) / 1e9 + 's',
        endTime: (w.endTime?.seconds || 0) + (w.endTime?.nanos || 0) / 1e9 + 's',
      })));
    }
    if (!fullText.trim()) throw new Error('No se detectó voz en el archivo.');

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ text: fullText.trim(), confidence: confCount > 0 ? totalConf / confCount : null, words: allWords }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
