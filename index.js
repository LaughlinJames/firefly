const express = require('express');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https'); // For handling HTTPS requests
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Folder where uploads are temporarily stored

const app = express();
const PORT = 3000;

// Ensure the 'downloads' directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

// Serve the form to generate image
app.get('/', (req, res) => {
  const prompt = req.query.prompt || '';

  res.send(`
    <html>
      <head>
        <title>Adobe Firefly AI Image Generator</title>
        <style>
          body {
            font-family: 'Source Sans Pro', sans-serif;
            background-color: #f4f5f7;
            margin: 0;
            padding: 0;
            color: #333;
          }
          h1 {
            text-align: center;
            color: #2c3e50;
            font-size: 32px;
            margin-top: 50px;
          }
          form {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
          textarea {
            width: 100%;
            height: 120px;
            border-radius: 4px;
            border: 1px solid #ccc;
            padding: 10px;
            font-size: 16px;
            box-sizing: border-box;
            margin-bottom: 20px;
            resize: none;
          }
          button {
            background-color: #1a73e8;
            color: #fff;
            border: none;
            padding: 12px 20px;
            font-size: 16px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.3s ease;
          }
          button:hover {
            background-color: #155dcd;
          }
          a {
            text-decoration: none;
            color: #1a73e8;
            font-weight: bold;
          }
          a:hover {
            text-decoration: underline;
          }
          .content {
            text-align: center;
            margin-top: 40px;
          }
        </style>
      </head>
      <body>
        <h1>Generate an AI Image</h1>
        <form action="/generate" method="get">
          <label for="prompt">Enter a prompt:</label><br>
          <textarea id="prompt" name="prompt" required>${prompt}</textarea><br><br>
          <button type="submit">Generate Image</button>
        </form>
      </body>
    </html>
  `);
});

// Route to generate image based on the prompt
app.get('/generate', async (req, res) => {
  const prompt = req.query.prompt;

  if (!prompt) {
    return res.status(400).send('Prompt is required');
  }

  try {
    const accessToken = await retrieveAccessToken();
    const imageUrl = await generateImage(accessToken, prompt);
    res.send(`
      <html>
        <head>
          <title>Generated Image</title>
          <style>
            body {
              font-family: 'Source Sans Pro', sans-serif;
              background-color: #f4f5f7;
              color: #333;
              text-align: center;
            }
            img {
              max-width: 90%;
              border-radius: 8px;
              margin-top: 20px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            }
            .content {
              margin-top: 30px;
            }
            button {
              background-color: #1a73e8;
              color: #fff;
              border: none;
              padding: 12px 20px;
              font-size: 16px;
              border-radius: 4px;
              cursor: pointer;
            }
            button:hover {
              background-color: #155dcd;
            }
            a {
              text-decoration: none;
              color: #1a73e8;
              font-weight: bold;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <h1>Generated Image for Prompt:</h1>
          <p><em>${prompt}</em></p>
          <img src="${imageUrl}" alt="Generated Image"/><br><br>
          <div class="content">
            <a href="/">Start over</a> | 
            <a href="/?prompt=${encodeURIComponent(prompt)}">Edit the prompt</a> | 
            <a href="/generate?prompt=${encodeURIComponent(prompt)}">Regenerate with the same prompt</a><br><br>
            <a href="/download?imageUrl=${encodeURIComponent(imageUrl)}">
              <button>Download Image</button>
            </a>
          </div>
        </body>
      </html>
    `);
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
  return response.data.outputs[0].image.url;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
