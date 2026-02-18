const { Storage } = require('@google-cloud/storage');

function getCreds() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('Falta la variable GOOGLE_CREDENTIALS en Netlify');
  }
  const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return {
    credentials: {
      client_email: c.client_email,
      // Corrección crítica: asegura que los saltos de línea sean reales
      private_key: c.private_key.split(String.raw`\n`).join('\n').replace(/\\n/g, '\n')
    },
    projectId: c.project_id
  };
}

const creds = getCreds();
const storage = new Storage(creds);

exports.handler = async (event) => {
  // Configuración de CORS
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
    const { fileName, contentType } =
