const express = require('express'); // For creating the server
const axios = require('axios'); // For making HTTP requests
const qs = require('qs'); // For query string parsing
require('dotenv').config(); // For loading environment variables from .env file
const fs = require('fs'); // For file system operations
const path = require('path'); // For handling file paths
const https = require('https'); // For handling HTTPS requests
const multer = require('multer'); // For handling file uploads
const upload = multer({ dest: 'uploads/' }); // Folder where uploads are temporarily stored

const app = express(); 
const PORT = 3000;

// external CSS and JS files
app.use(express.static('public')); // Serve static files from the 'public' directory

// Ensure the 'downloads' directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

// HTML wrapper with Adobe header
const htmlWrapper = (bodyContent) => `
  <html>
    <head>
      <title>Adobe Firefly Image Generator</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <header>
        <img src="https://www.adobe.com/home/assets/adobe_wordmark_red.svg" alt="Adobe Logo" />
      </header>
      <main>
        ${bodyContent}
      </main>
    </body>
  </html>
`;

// Route to show form
app.get('/', (req, res) => {
  const prompt = req.query.prompt || '';
  const body = `
    <h1>Generate a Firefly Image</h1>
    <form action="/generate" method="post" enctype="multipart/form-data">
      <label for="prompt">Enter a prompt:</label><br>
      <textarea id="prompt" name="prompt" required>${prompt}</textarea><br><br>
      
      <label for="referenceImage">Add a reference image:</label><br>
      <input type="file" id="referenceImage" name="referenceImage" accept="image/*"><br><br>

      <button type="submit">Generate Image</button>
    </form>
  `;
  res.send(htmlWrapper(body));
});

// Route to generate image
app.post('/generate', upload.single('referenceImage'), async (req, res) => {
  const prompt = req.body.prompt;
  const referenceImage = req.file; // Contains uploaded file info, if any

  if (!prompt) {
    return res.status(400).send('Prompt is required');
  }

  try {
    const accessToken = await retrieveAccessToken();
    const responseData = await generateImage(accessToken, prompt);
    // console.log('Access Token:', accessToken);
    const imageUrl = responseData.outputs[0].image.url;
    const seed = responseData.outputs[0].seed;
    console.log('Generated Image seed:', seed);

    const body = `
      <h1>Firefly Generated Image for Prompt:</h1>
      <p><em>${prompt}</em></p>
      ${referenceImage ? `<p>Reference image uploaded: ${referenceImage.originalname}</p>` : ''}
      <img src="${imageUrl}" alt="Generated Image" class="generated-image"/><br><br>
      <div class="content">
        <a href="/">Start over</a> |
        <a href="/?prompt=${encodeURIComponent(prompt)}">Edit the prompt</a><br>
        <a href="/generate?prompt=${encodeURIComponent(prompt)}&seed=${encodeURIComponent(seed)}">Generate images similar to this one</a><br><br>
        <a href="/download?imageUrl=${encodeURIComponent(imageUrl)}">
          <button>Download Image</button>
        </a>
      </div>
    `;
    res.send(htmlWrapper(body));
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating image');
  }
});

app.get('/generate', async (req, res) => {
  const prompt = req.query.prompt;
  const seed = req.query.seed || 'random';

  if (!prompt) {
    return res.status(400).send('Prompt is required');
  }

  try {
    const accessToken = await retrieveAccessToken();
    console.log('Access Token:', accessToken);
    const responseData = await generateImage(accessToken, prompt, seed);
    const imageUrl = responseData.outputs[0].image.url;

    const body = `
      <h1>Firefly Generated Image for Prompt:</h1>
      <p><em>${prompt}</em></p>
      <img src="${imageUrl}" alt="Generated Image" class="generated-image"/><br><br>
      <div class="content">
        <a href="/">Start over</a> |
        <a href="/?prompt=${encodeURIComponent(prompt)}">Edit the prompt</a><br>
        <a href="/generate?prompt=${encodeURIComponent(prompt)}&seed=${encodeURIComponent(seed)}">Generate images similar to this one</a><br><br>
        <a href="/download?imageUrl=${encodeURIComponent(imageUrl)}">
          <button>Download Image</button>
        </a>
      </div>
    `;
    res.send(htmlWrapper(body));
  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating image');
  }
});


// Route to handle image download
app.get('/download', async (req, res) => {
  const imageUrl = req.query.imageUrl;

  if (!imageUrl) {
    return res.status(400).send('Image URL is required');
  }

  const filePath = path.join(downloadsDir, 'firefly_image.png');

  // Download the image and save it to the file system
  try {
    await downloadImage(imageUrl, filePath);
    // Send the file to the client for download
    res.download(filePath, 'firefly_image.png', (err) => {
      if (err) {
        res.status(500).send('Error downloading image');
      } else {
        // Optionally, delete the file after download
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error downloading image');
  }
});

// Function to retrieve access token
async function retrieveAccessToken() {
  const data = qs.stringify({
    grant_type: 'client_credentials',
    client_id: process.env.FIREFLY_SERVICES_CLIENT_ID,
    client_secret: process.env.FIREFLY_SERVICES_CLIENT_SECRET,
    scope: 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis',
  });

  const config = {
    method: 'post',
    url: 'https://ims-na1.adobelogin.com/ims/token/v3',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: data,
  };

  const response = await axios.request(config);
  return response.data.access_token;
}

// Function to download the image
async function downloadImage(imageUrl, filePath) {
  return new Promise((resolve, reject) => {
    https.get(imageUrl, (response) => {
      const writer = fs.createWriteStream(filePath);
      response.pipe(writer);
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  });
}

// Function to generate image based on the prompt
async function generateImage(accessToken, prompt) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-api-key': process.env.FIREFLY_SERVICES_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`,
  };

  const data = {
    prompt: prompt,
  };

  const config = {
    method: 'post',
    url: 'https://firefly-api.adobe.io/v3/images/generate',
    headers: headers,
    data: data,
  };

  const response = await axios.request(config);
  // console.log('Response:', response.data);
  return response.data;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
