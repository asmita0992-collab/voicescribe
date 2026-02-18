const { Storage } = require('@google-cloud/storage');

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

const creds = getCreds();
const storage = new Storage(creds);

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
    const { fileName, contentType } = JSON.parse(event.body);
    const uniqueName = `uploads/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const bucketName = `${creds.projectId}-voicescribe-temp`;

    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    if (!exists) {
        console.log(`Creando bucket: ${bucketName}`);
        await storage.createBucket(bucketName, { location: 'US' });
        await bucket.setCorsConfiguration([{
            maxAgeSeconds: 3600,
            method: ['PUT', 'POST'],
            origin: ['*'], 
            responseHeader: ['Content-Type']
        }]);
    }

    const [url] = await bucket.file(uniqueName).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: contentType,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url, gcsUri: `gs://${bucketName}/${uniqueName}` }),
    };
  } catch (error) {
    console.error("Error en upload-url:", error);
    return { 
      statusCode: 500, 
      headers,
      body: JSON.stringify({ error: error.message, stack: error.stack }) 
    };
  }
};
