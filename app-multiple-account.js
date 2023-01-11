const { Client, MessageMedia, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const request = require('request')
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const port = process.env.PORT || 8000;
const vuri = require('valid-url');
var cron = require('node-cron');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));


const mediadownloader = (url, path, callback) => {
  request.head(url, (err, res, body) => {
    request(url)
      .pipe(fs.createWriteStream(path))
      .on('close', callback)
  })
}

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
 */
app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch (err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = async function (id, description) {
  console.log('Creating session: ' + id);

  await mongoose.connect("mongodb://localhost:27017/appms");
  const store = new MongoStore({ mongoose });
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      //executablePath: "/usr/bin/google-chrome",
    },
    authStrategy: new RemoteAuth({
      store,
      backupSyncIntervalMs: 300000, // in ms, minimum interval starts at 60000
      clientId: id, // I would say it's required
      //dataPath: './your_sessions_path/', // optional
    })
    // authStrategy: new LocalAuth({
    //   clientId: id
    // })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function () {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    console.log(id);
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

    var obj = savedSessions[sessionIndex];
    savedSessions.splice(sessionIndex, 1);
    //setSessionsFile(savedSessions); 
    //io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      /**
       * At the first time of running (e.g. restarting the server), our client is not ready yet!
       * It will need several time to authenticating.
       * 
       * So to make people not confused for the 'ready' status
       * We need to make it as FALSE for this condition
       */
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function (socket) {
  init(socket);

  socket.on('create-session', function (data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});

var inc = 0;
cron.schedule('*/2 * * * * *', async () => {
  inc = inc + 1;

  console.log(new Date(new Date() - 3600 * 1000 * 3).toISOString());
  console.log(inc)
  if (inc > 30) { 
    const client = sessions.find(sess => sess.id == 'myhij')?.client;
    if (!client) {
      return;
    }

    var number = '916238611728';
    number = phoneNumberFormatter(number);
    const isRegisteredNumber = await client.isRegisteredUser(number);

    if (!isRegisteredNumber) {
      return;
    }
    client.sendMessage(number, new Date(new Date() - 3600 * 1000 * 3).toISOString()).then(response => {

    }).catch(err => {

    });
  }


});



// Send message
app.post('/send-message', async (req, res) => {
  console.log(req.body);
  try {
    const sender = req.body.sender;
    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;
    const type = req.body.type;
    let image = req.body.image;

    const client = sessions.find(sess => sess.id == sender)?.client;

    // Make sure the sender is exists & ready
    if (!client) {
      return res.status(422).json({
        status: false,
        message: `The sender: ${sender} is not found!`
      })

    }

    /**
     * Check if the number is already registered
     * Copied from app.js
     * 
     * Please check app.js for more validations example
     * You can add the same here!
     */
    const isRegisteredNumber = await client.isRegisteredUser(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
    if (vuri.isWebUri(image)) {
      const templateButtons = [
        { index: 1, urlButton: { displayText: '⭐ Star Baileys on GitHub!', url: 'https://github.com/adiwajshing/Baileys' } },
        { index: 2, callButton: { displayText: 'Call me!', phoneNumber: '+1 (234) 5678-901' } },
        { index: 3, quickReplyButton: { displayText: 'This is a reply, just like normal buttons!', id: 'id-like-buttons-message' } },
      ]

      const templateMessage = {
        text: "Hi it's a template message",
        footer: 'Hello World',
        templateButtons: templateButtons
      }

      const media = await MessageMedia.fromUrl(image);
      client.sendMessage(number, media, { caption: message || '' }).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(200).json({
          status: false,
          response: err
        });
      });

    }
    else {
      client.sendMessage(number, message).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(200).json({
          status: false,
          response: err
        });
      });
    }
  }
  catch (e) {
    res.status(200).json({
      status: false,
      response: e
    });
  }
});

server.listen(port, function () {
  console.log('App running on *: ' + port);
});
