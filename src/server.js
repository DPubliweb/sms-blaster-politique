require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const helmet = require('helmet');
const multer = require('multer');
const axios = require('axios');

const csvService = require('./services/csv');
const smsService = require('./services/sms');
const rateLimiterService = require('./services/rateLimiter');

const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage }).single('file');

const port = process.env.PORT || 8080;
const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
//const senderId = process.env.SENDER_ID;
const tps = parseInt(process.env.TPS || '40', 10);
const csvFromLine = parseInt(process.env.CSV_SKIP_LINES || '0', 10) + 1;
const authMiddleware = require('./middlewares/auth');
//const authMiddleware = require('./middlewares/auth');
console.log(`Will start reading CSV from row ${csvFromLine}`);
const rateLimitAxios = rateLimiterService.newInstance(tps);


// Always use UTC Timezone
process.env.TZ = 'Etc/UTC';
const requestMaxSize = '150mb';

const app = express();

app.set('trust proxy', true);
app.use(helmet());
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true, limit: requestMaxSize }));
app.use(bodyParser.json({ limit: requestMaxSize }));

app.get('/', (_, res) => res.send('Hello world'));
app.get('/success', (_, res) => res.send('You have successfully deployed the Simple SMS Blaster'));

// For Internal Use, called by Upload
app.post('/blast', authMiddleware, (req, res) => {
  const {
    campaignName,
    records,
    offset = 0,
    limit = tps,
    senderid
  } = req.body;
  res.send('ok');

  if (offset > records.length) {
    // Done
    console.log('Done');
    return;
  }

  const end = Math.min(offset + limit, records.length);
  for (let i = offset; i < end; i += 1) {
    // Parse CSV Columns
    // This is where you can modify the CSV structure
    const record = records[i];
    const to = record[0];
    const text = record[1];

    // Add to queue
    smsService.sendSms(senderid, to, text, apiKey, apiSecret, apiUrl, campaignName, rateLimitAxios);
  }

  console.log(`Blast Limit: ${limit}, Offset ${offset}`);
  setTimeout(() => axios.post(`http://localhost:${port}/blast`, {
    campaignName,
    records,
    offset: offset + limit,
    limit,
    senderid,
  }, {
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }), 1000);
});

app.post('/send', authMiddleware, async (req, res) => {
  try {
    const { campaign = 'campaign', records = [] , senderid } = req.body;
    const promises = records.map(async (record) => {
      try {
        // Get Record Parameters
        const { uuid, to, text } = record;
    
        // Add to queue
        const result = await smsService.sendSms(senderid, to, text, apiKey, apiSecret, apiUrl, campaign, rateLimitAxios);
        return Promise.resolve(Object.assign({}, result, { uuid, to, text }));
      } catch (error) {
        return Promise.reject(error);
      }
    });

    const results = await Promise.all(promises);
    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// For User use, for uploading CSV
app.post('/upload', authMiddleware, upload,  (req, res) => {
  // Use file name as campaign name
  let campaignName = req.file.originalname;
  if (campaignName.toLowerCase().lastIndexOf('.csv') === campaignName.length - 4) {
    campaignName = campaignName.slice(0, campaignName.length - 4);
  }
  console.log(`Campaign Name: ${campaignName}`);
  console.log(req.body.senderid);

  // Data will be in req.file.buffer
  const dataBuffer = req.file.buffer;
  const dataString = dataBuffer.toString('utf8');

  // Get current date and time
  const now = new Date();
  now.setHours(now.getHours() + 2); // Add 2 hours to the current time
  const formattedDate = now.toLocaleDateString('fr-FR'); // Format DD/MM/YYYY
  const formattedTime = now.toLocaleTimeString('fr-FR'); // Format HH:MM:SS

  // Return response with file name, date, and time
  res.send(`Votre fichier ${campaignName} a bien été envoyé le ${formattedDate} à ${formattedTime}`);

  // Parse CSV into Array
  const options = { from_line: csvFromLine };
  const recordList = csvService.fromCsvSync(dataString, options);

  // Start blasting
  setImmediate(() => axios.post(`http://localhost:${port}/blast`, {
    campaignName,
    records: recordList,
    offset: 0,
    limit: tps,
    senderid: req.body.senderid,
  }, {
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }));
});

// Create Application HTTP Server
const httpServer = http.createServer(app);
httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
