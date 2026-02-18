const { Storage } = require('@google-cloud/storage');

// Función robusta para leer credenciales y arreglar el formato de la clave
function getCreds() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Falta la variable GOOGLE_CREDENTIALS en Netlify');
  }
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  
  // Limpieza agresiva de la clave privada
  let privateKey = c.private_key;
  if (privateKey) {
    // 1. Reemplazar saltos de línea literales por reales
    privateKey = privateKey.replace(/\\n/g, '\n');
    
    // 2. Asegurar que los encabezados tengan sus propios renglones si se perdieron
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

const creds = getCreds();
const storage = new Storage(creds);

exports.handler = async (event) => {
  // Headers CORS para permitir peticiones desde tu web
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
    // Crear nombre único para evitar sobreescribir archivos
    const uniqueName = `uploads/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const bucketName = `${creds.projectId}-voicescribe-temp`;

    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    
    // Si el bucket no existe, intentar crearlo y configurar CORS
    if (!exists) {
        console.log(`Creando bucket: ${bucketName}`);
        try {
            await storage.createBucket(bucketName, { location: 'US' });
            await bucket.setCorsConfiguration([{
                maxAgeSeconds: 3600,
                method: ['PUT', 'POST'],
                origin: ['*'], 
                responseHeader: ['Content-Type']
            }]);
        } catch (bucketErr) {
            console.warn("Aviso al crear bucket (puede que ya exista):", bucketErr.message);
        }
    }

    // Generar URL firmada (Signed URL)
    const [url] = await bucket.file(uniqueName).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutos
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
