const { Storage } = require('@google-cloud/storage');

// Helper para leer tus credenciales actuales
function getCreds() {
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return {
    credentials: { client_email: c.client_email, private_key: c.private_key },
    projectId: c.project_id
  };
}

const storage = new Storage(getCreds());

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { fileName, contentType } = JSON.parse(event.body);
    // Usamos un nombre único para evitar colisiones
    const uniqueName = `uploads/${Date.now()}_${fileName.replace(/\s/g, '_')}`;
    const bucketName = `${getCreds().projectId}-voicescribe-temp`; // Nombre automático del bucket

    // IMPORTANTE: El bucket debe existir. Si no existe, intenta crearlo (solo funciona si tienes permisos de admin)
    // Para producción, crea el bucket manualmente en Google Cloud Console.
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    if (!exists) {
        await storage.createBucket(bucketName, { location: 'US' });
        // Configurar CORS para que el navegador pueda subir archivos
        await bucket.setCorsConfiguration([{
            maxAgeSeconds: 3600,
            method: ['PUT', 'POST'],
            origin: ['*'], // En producción, pon tu dominio de Netlify aquí
            responseHeader: ['Content-Type']
        }]);
    }

    const [url] = await bucket.file(uniqueName).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutos
      contentType: contentType,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url, gcsUri: `gs://${bucketName}/${uniqueName}` }),
    };
  } catch (error) {
    console.error("Error en upload-url:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
